"""Phase Pal's ChatV2 file and global-index contract (not Unity asset metadata)."""
import base64
import hashlib
import re
import uuid

from .source import Conversation

NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://github.com/sobiesie/OpenChatLink/chatgpt")
RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
            *(f"LPT{i}" for i in range(1, 10))}


def identifier(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value) or value.upper() in RESERVED:
        raise ValueError("Character ID must be a Phase Pal identifier: letters, numbers, '-' or '_'.")
    return value


def encode(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def decode(value: str) -> str:
    return base64.b64decode(value, validate=True).decode("utf-8")


def digest(data: bytes | None) -> str | None:
    return hashlib.sha256(data).hexdigest() if data is not None else None


def session_id(conversation: Conversation) -> str:
    # Source scope is deliberate: never merge personal/workspace/export accounts implicitly.
    return str(uuid.uuid5(NAMESPACE, conversation.source + "\0" + conversation.identity))


def serialize(conversation: Conversation, character: str, name: str) -> bytes:
    sid = session_id(conversation)
    metadata = {
        "openchatlink.source_id": conversation.source,
        "openchatlink.external_id": conversation.identity,
        "phasepal.turn_character_id": character,
        "phasepal.turn_character_name": name,
    }
    encoded_metadata = ";".join(encode(k) + ":" + encode(v) for k, v in sorted(metadata.items()))
    lines = []
    for message in conversation.messages:
        lines.append("|".join([
            encode(f"ocl_{sid}_{message.index}"), "1" if message.role == "user" else "2", "0",
            encode(message.text), encode(message.text), "", "", str(message.created_ms),
            "", "0", encoded_metadata, "", "",
        ]))
    return ("\n".join(lines) + "\n").encode("utf-8")


def parse_index(data: bytes | None) -> dict[str, list[str]]:
    entries = {}
    for line in (data or b"").decode("utf-8-sig").splitlines():
        parts = line.split("\t")
        if len(parts) != 9 or parts[7] not in {"0", "1"} or parts[8] not in {"0", "1"}:
            raise ValueError("Phase Pal global index is damaged. No files were changed.")
        values = [decode(p) for p in parts[:7]] + parts[7:]
        identifier(values[0])
        identifier(values[1])
        if values[5]:
            identifier(values[5])
            identifier(values[6])
        if values[0] in entries:
            raise ValueError("Phase Pal global index has duplicate IDs.")
        entries[values[0]] = values
    return entries


def serialize_index(entries: dict[str, list[str]]) -> bytes:
    return "".join("\t".join([encode(v) for v in entries[k][:7]] + entries[k][7:]) + "\n"
                   for k in sorted(entries)).encode("utf-8")


def metadata(old: bytes | None, title: str, character: str, name: str, global_layout: bool,
             previous_title: str | None) -> bytes:
    lines = (old or b"").decode("utf-8-sig").splitlines()
    existing_title = next((decode(line[6:]) for line in lines if line.lower().startswith("title=")), None)
    # Keep a title renamed in Phase Pal. Unknown flags and identities are preserved verbatim.
    chosen_title = existing_title if existing_title is not None and existing_title != previous_title else title
    lines = [line for line in lines if not line.lower().startswith("title=")]
    lines.insert(0, "title=" + encode(chosen_title))
    if not any(line.lower().startswith("pinned=") for line in lines):
        lines.append("pinned=0")
    if global_layout and not any(line.startswith("global_schema=") for line in lines):
        lines += ["global_schema=1", "global_home_id=" + encode(character),
                  "global_home_name=" + encode(name), "global_last_id=" + encode(character),
                  "global_last_name=" + encode(name), "global_legacy_character=", "global_legacy_session="]
    return ("\n".join(lines) + "\n").encode("utf-8")


def metadata_index_row(sid: str, data: bytes) -> str:
    values = dict(line.split("=", 1) for line in data.decode("utf-8-sig").splitlines() if "=" in line)
    values = {key.lower(): value for key, value in values.items()}
    job_id, job_alias = values.get("job_id", ""), values.get("job_alias", "")
    is_job = values.get("job_session", "0").lower() in {"1", "true"} or bool(job_id or job_alias)
    return "|".join(["1", "U", encode(sid), values.get("title", ""),
                     "1" if values.get("pinned", "0").lower() in {"1", "true"} else "0",
                     "1" if is_job else "0", job_id, job_alias, "1" if "job_session" in values else "0"])


def append_journal(old: bytes | None, rows: list[str]) -> bytes:
    # Preserve all unrelated rows; later entries override earlier ones in Phase Pal's reader.
    content = (old or b"").decode("utf-8-sig")
    if content and not content.endswith("\n"):
        content += "\n"
    return (content + "\n".join(rows) + "\n").encode("utf-8")
