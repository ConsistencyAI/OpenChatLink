"""CLI for previews, one-shot imports, polling, source listing, and rollback."""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time

from . import __version__
from .files import BusyError, locked, require_stopped, rollback
from .source import list_sources
from .sync import Options, sync


def expanded(value: str) -> Path:
    return Path(os.path.expandvars(value)).expanduser().absolute()


def default_database() -> str:
    base = os.environ.get("XDG_DATA_HOME")
    if not base:
        base = os.environ.get("LOCALAPPDATA") if os.name == "nt" else "~/.local/share"
    return str(Path(base or "~/.local/share") / "hstry" / "hstry.db")


def parser() -> argparse.ArgumentParser:
    cli = argparse.ArgumentParser(description="Sync selected hstry ChatGPT conversations into Phase Pal.")
    cli.add_argument("--version", action="version", version=__version__)
    commands = cli.add_subparsers(dest="command", required=True)
    for verb in ("sync", "watch", "sources", "rollback"):
        command = commands.add_parser(verb)
        command.add_argument("--config", help="Path to a local JSON configuration")
        command.add_argument("--json", action="store_true", help="Machine-readable output without chat text")
        command.add_argument("--hstry-db", help="hstry SQLite database (read-only)")
        if verb in {"sync", "watch", "rollback"}:
            command.add_argument("--history-dir", help="Existing scoped Phase Pal ChatV2History directory")
        if verb in {"sync", "watch"}:
            command.add_argument("--character-id", help="Installed Phase Pal avatar ID, not its display name")
            command.add_argument("--character-name", help="Display name for imported turns")
            command.add_argument("--source", action="append", help="Exact hstry source ID; repeat for more sources")
            command.add_argument("--conversation-id", action="append", help="hstry or external conversation ID; repeat")
            command.add_argument("--layout", choices=["auto", "global", "character"])
            command.add_argument("--dry-run", action="store_true", help="Preview; do not write any files")
        if verb == "watch":
            command.add_argument("--interval", type=float, default=30, help="Seconds between local database checks")
        if verb == "rollback":
            command.add_argument("backup", help="Backup ID returned by a prior sync")
    return cli


def settings(args) -> dict:
    config = json.loads(expanded(args.config).read_text(encoding="utf-8-sig")) if args.config else {}
    if not isinstance(config, dict):
        raise ValueError("Configuration must be a JSON object.")
    allowed = {"hstry_db", "history_dir", "character_id", "character_name", "sources", "conversation_ids", "layout"}
    if config.keys() - allowed:
        raise ValueError("Configuration has unknown fields.")
    for attribute, key in [("hstry_db", "hstry_db"), ("history_dir", "history_dir"),
                           ("character_id", "character_id"), ("character_name", "character_name"),
                           ("source", "sources"), ("conversation_id", "conversation_ids"), ("layout", "layout")]:
        value = getattr(args, attribute, None)
        if value is not None:
            config[key] = value
    config.setdefault("hstry_db", default_database())
    config.setdefault("sources", ["chatgpt-web"])
    config.setdefault("conversation_ids", [])
    config.setdefault("character_name", "")
    config.setdefault("layout", "auto")
    for key in {"hstry_db", "history_dir", "character_id", "character_name", "layout"} & config.keys():
        if not isinstance(config[key], str):
            raise ValueError(f"{key} must be a string.")
    for key in {"sources", "conversation_ids"}:
        if not isinstance(config[key], list) or any(not isinstance(v, str) or not v for v in config[key]):
            raise ValueError(f"{key} must be a list of nonempty strings.")
    return config


def output(value: dict | list, machine: bool) -> None:
    if machine:
        print(json.dumps(value, ensure_ascii=False, sort_keys=True), flush=True)
    elif isinstance(value, list):
        for row in value:
            print(f"{row['id']} ({row['adapter']}): {row['conversations']} conversations")
    elif value.get("waiting"):
        print("Waiting for Phase Pal and Unity to close.", flush=True)
    elif "created" in value:
        print(f"{'Preview' if value['dry_run'] else 'Sync'}: {value['created']} new, "
              f"{value['updated']} updated, {value['unchanged']} unchanged, "
              f"{len(value['conflicts'])} conflicts, {value['skipped_deleted']} deleted chats skipped.", flush=True)
        if value["backup"]:
            print("Backup: " + value["backup"], flush=True)
        for conflict in value["conflicts"]:
            print(f"Skipped {conflict['session']}: {conflict['reason']}", flush=True)
    else:
        print(value.get("message", "Done."), flush=True)


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        config = settings(args)
        if args.command == "sources":
            output(list_sources(expanded(config["hstry_db"])), args.json)
            return 0
        if not config.get("history_dir"):
            raise ValueError("Provide --history-dir or history_dir in the configuration.")
        root = expanded(config["history_dir"])
        if args.command == "rollback":
            if not root.is_dir() or root.name != "ChatV2History":
                raise ValueError("Choose an existing ChatV2History directory.")
            require_stopped()
            with locked(root):
                rollback(root, args.backup, require_stopped)
            output({"message": "Backup restored.", "backup": args.backup}, args.json)
            return 0
        if not config.get("character_id"):
            raise ValueError("Provide --character-id or character_id in the configuration.")
        options = Options(expanded(config["hstry_db"]), root, config["character_id"],
                          config["character_name"], config["sources"], config["conversation_ids"], config["layout"])
        if args.command == "sync":
            report = sync(options, args.dry_run)
            output(report, args.json)
            return 2 if report["conflicts"] else 0
        if not 1 <= args.interval <= 86400:
            raise ValueError("Watch interval must be between 1 and 86400 seconds.")
        previous = None
        while True:
            try:
                report = sync(options, args.dry_run)
            except BusyError:
                report = {"waiting": True}
            # Quiet on unchanged polls; emit changes, conflicts, and transitions to/from waiting.
            summary = json.dumps({k: v for k, v in report.items() if k != "backup"}, sort_keys=True)
            if summary != previous or report.get("backup"):
                output(report, args.json)
            previous = summary
            time.sleep(args.interval)
    except KeyboardInterrupt:
        return 130
    except (ValueError, TypeError, KeyError, OSError, RuntimeError, sqlite3.Error, subprocess.SubprocessError) as error:
        # Avoid raw database rows, conversation text, or secret-bearing config values in errors.
        message = str(error) if isinstance(error, (ValueError, BusyError)) else "Operation failed. Check local paths, configuration, and file permissions."
        if args.json:
            output({"error": message}, True)
        else:
            print("OpenChatLink: " + message, file=sys.stderr)
        return 1
