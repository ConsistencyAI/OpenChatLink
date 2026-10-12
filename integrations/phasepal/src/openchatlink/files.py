"""Bounded file writes with backups, optimistic checks, and crash recovery."""
from contextlib import contextmanager
import csv
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import uuid

from .format import digest


class BusyError(RuntimeError):
    pass


def require_stopped() -> None:
    if os.name == "nt":
        output = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], check=True,
                                capture_output=True, text=True, timeout=15,
                                creationflags=subprocess.CREATE_NO_WINDOW).stdout
        names = [row[0] for row in csv.reader(io.StringIO(output)) if row]
    else:
        output = subprocess.run(["ps", "-A", "-o", "comm="], check=True,
                                capture_output=True, text=True, timeout=15).stdout
        names = [Path(line.strip()).name for line in output.splitlines()]
    names = {name.lower().removesuffix(".exe").replace(" ", "").removesuffix(".x86_64") for name in names}
    if names & {"phasepal", "phasephal", "unity"}:
        raise BusyError("Close Phase Pal and the Unity Editor before importing. Watch mode will wait.")


def safe_path(root: Path, relative: str = "") -> Path:
    if Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ValueError("Invalid import path.")
    path = root.absolute() / relative
    # Reject Windows junctions as well as symlinks, including existing parent directories.
    for item in [path, *path.parents]:
        try:
            info = item.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("Linked paths are not allowed for Phase Pal history writes.")
    return path


def read(root: Path, relative: str) -> bytes | None:
    path = safe_path(root, relative)
    return path.read_bytes() if path.exists() else None


def atomic_write(path: Path, data: bytes | None) -> None:
    if data is None:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=".ocl-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


@contextmanager
def locked(root: Path):
    path = safe_path(root, ".openchatlink/sync.lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    file = path.open("a+b")
    try:
        if file.tell() == 0:
            file.write(b"0")
            file.flush()
        file.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise BusyError("Another OpenChatLink sync holds the lock.") from error
        yield
    finally:
        # Closing releases the OS lock even if a process crashes. The file is not a stale lease.
        file.close()


def transaction(root: Path, changes: dict[str, bytes], expected: dict[str, bytes | None],
                mtimes: dict[str, int], guard) -> str:
    guard()
    for relative in changes:
        if read(root, relative) != expected[relative]:
            raise ValueError("History changed during planning. Retry after closing Phase Pal.")
    backup_id = uuid.uuid4().hex
    base = f".openchatlink/backups/{backup_id}"
    journal = {"schema": 1, "status": "pending", "files": []}
    for position, (relative, data) in enumerate(changes.items()):
        old = expected[relative]
        backup_file = f"{base}/{position}.before"
        if old is not None:
            atomic_write(safe_path(root, backup_file), old)
        journal["files"].append({"path": relative, "before": digest(old), "after": digest(data),
                                 "backup": backup_file if old is not None else None,
                                 "mtime_ns": safe_path(root, relative).stat().st_mtime_ns if old is not None else None})
    journal_path = safe_path(root, f"{base}/journal.json")
    atomic_write(journal_path, json_bytes(journal))
    try:
        for relative, data in changes.items():
            guard()
            if read(root, relative) != expected[relative]:
                raise ValueError("History changed during commit. The backup was retained.")
            atomic_write(safe_path(root, relative), data)
            if relative in mtimes:
                timestamp_ns = mtimes[relative] * 1_000_000
                os.utime(safe_path(root, relative), ns=(timestamp_ns, timestamp_ns))
        journal["status"] = "committed"
        atomic_write(journal_path, json_bytes(journal))
    except Exception:
        # Recover only while the application remains closed. A pending journal is recoverable later.
        guard()
        rollback(root, backup_id, guard)
        raise
    return backup_id


def rollback(root: Path, backup_id: str, guard) -> None:
    if not len(backup_id) == 32 or any(c not in "0123456789abcdef" for c in backup_id):
        raise ValueError("Invalid backup ID.")
    journal_path = safe_path(root, f".openchatlink/backups/{backup_id}/journal.json")
    journal = json.loads(journal_path.read_bytes())
    if journal.get("schema") != 1 or journal.get("status") not in {"pending", "committed"}:
        raise ValueError("Backup is not pending or committed.")
    restored = []
    for item in journal["files"]:
        current = digest(read(root, item["path"]))
        if current not in {item["before"], item["after"]}:
            raise ValueError("Rollback would overwrite newer changes. No rollback files were changed.")
        original = read(root, item["backup"]) if item["backup"] else None
        if digest(original) != item["before"]:
            raise ValueError("Backup checksum failed. No rollback files were changed.")
        restored.append((item, original))
    guard()
    for item, original in reversed(restored):
        guard()
        path = safe_path(root, item["path"])
        if digest(read(root, item["path"])) not in {item["before"], item["after"]}:
            raise ValueError("History changed during rollback. Close the app and retry.")
        atomic_write(path, original)
        if original is not None:
            os.utime(path, ns=(item["mtime_ns"], item["mtime_ns"]))
    journal["status"] = "rolled_back"
    atomic_write(journal_path, json_bytes(journal))


def recover(root: Path, guard) -> None:
    directory = safe_path(root, ".openchatlink/backups")
    if not directory.exists():
        return
    for path in sorted(directory.iterdir()):
        journal_path = safe_path(root, f".openchatlink/backups/{path.name}/journal.json")
        if journal_path.is_file() and json.loads(journal_path.read_bytes()).get("status") == "pending":
            rollback(root, path.name, guard)
