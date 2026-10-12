"""Read a consistent snapshot of hstry's database without changing it."""
from dataclasses import dataclass
from pathlib import Path
import sqlite3

CHATGPT_ADAPTERS = {"chatgpt", "chatgpt-web", "chatgpt-teams"}


@dataclass(frozen=True)
class Message:
    index: int
    role: str
    text: str
    created_ms: int


@dataclass(frozen=True)
class Conversation:
    source: str
    identity: str
    database_id: str
    title: str
    updated_ms: int
    messages: tuple[Message, ...]
    omitted: int = 0


def connect(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise ValueError("hstry database does not exist. Start hstry-api and sync first.")
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only = ON")
    return db


def list_sources(path: Path) -> list[dict]:
    db = connect(path)
    try:
        return [dict(row) for row in db.execute(
            "SELECT s.id, s.adapter, COUNT(c.id) AS conversations FROM sources s "
            "LEFT JOIN conversations c ON c.source_id=s.id GROUP BY s.id ORDER BY s.id"
        ) if row["adapter"] in CHATGPT_ADAPTERS]
    finally:
        db.close()


def read_conversations(path: Path, sources: list[str], ids: list[str]) -> list[Conversation]:
    if not sources:
        raise ValueError("Select at least one hstry source.")
    db = connect(path)
    try:
        db.execute("BEGIN")  # Includes WAL changes while keeping all rows at one snapshot.
        available = {r["id"]: r["adapter"] for r in db.execute("SELECT id, adapter FROM sources")}
        for source in sources:
            if available.get(source) not in CHATGPT_ADAPTERS:
                raise ValueError("A selected source is missing or is not a ChatGPT adapter. Run sources.")
        marks = ",".join("?" for _ in sources)
        rows = db.execute(
            f"SELECT id, source_id, external_id, title, created_at, updated_at "
            f"FROM conversations WHERE source_id IN ({marks}) ORDER BY source_id, id", sources
        ).fetchall()
        result = []
        matched = set()
        for row in rows:
            identity = row["external_id"] or row["id"]
            if ids and row["id"] not in ids and identity not in ids:
                continue
            matched.update({row["id"], identity})
            created = row["created_at"]
            updated = row["updated_at"] if row["updated_at"] is not None else created
            if not isinstance(created, int) or not isinstance(updated, int):
                raise ValueError("Unsupported hstry timestamps: expected integer Unix seconds.")
            if not -62135596800 <= updated <= 253402300799:
                raise ValueError("hstry conversation timestamp is outside Phase Pal's supported range.")
            messages, omitted = [], 0
            for msg in db.execute(
                "SELECT idx, role, content, created_at FROM messages WHERE conversation_id=? ORDER BY idx",
                (row["id"],),
            ):
                if not isinstance(msg["idx"], int) or msg["idx"] < 0 or not isinstance(msg["content"], str):
                    raise ValueError("Unsupported hstry message index or text.")
                # Do not turn imported system/tool data into live instructions or tool execution.
                if msg["role"] not in {"user", "assistant"} or not msg["content"].strip():
                    omitted += 1
                    continue
                timestamp = msg["created_at"] if msg["created_at"] is not None else created
                if not isinstance(timestamp, int) or timestamp < -62135596800 or timestamp > 253402300799:
                    raise ValueError("hstry message timestamp is outside Phase Pal's supported range.")
                messages.append(Message(msg["idx"], msg["role"], msg["content"], timestamp * 1000))
            result.append(Conversation(row["source_id"], identity, row["id"],
                                       row["title"] or "Imported ChatGPT chat", updated * 1000,
                                       tuple(messages), omitted))
        if set(ids) - matched:
            raise ValueError("A requested conversation was not found in the selected sources.")
        return result
    finally:
        db.close()
