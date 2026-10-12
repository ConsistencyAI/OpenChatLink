"""Plan and commit one-way history updates, preserving locally changed sessions."""
from dataclasses import dataclass, field
import json
from pathlib import Path

from .files import json_bytes, locked, read, recover, require_stopped, safe_path, transaction
from .format import (append_journal, digest, encode, identifier, metadata, metadata_index_row,
                     parse_index, serialize, serialize_index, session_id)
from .source import read_conversations


@dataclass
class Options:
    database: Path
    history: Path
    character: str
    character_name: str = ""
    sources: list[str] = field(default_factory=lambda: ["chatgpt-web"])
    conversation_ids: list[str] = field(default_factory=list)
    layout: str = "auto"


def validate(options: Options) -> str:
    identifier(options.character)
    safe_path(options.history)
    if not options.history.is_dir() or options.history.name != "ChatV2History":
        raise ValueError("Choose the existing ChatV2History directory inside the intended Phase Pal data scope.")
    if options.layout not in {"auto", "global", "character"}:
        raise ValueError("Layout must be auto, global, or character.")
    has_index = read(options.history, "global_v1/migration_v1.index") is not None
    layout = options.layout if options.layout != "auto" else "global" if has_index else "character"
    if layout == "character" and has_index:
        raise ValueError("This history already uses the global index. Use auto or global layout.")
    return layout


def plan(options: Options) -> tuple[dict, dict[str, bytes], dict[str, bytes | None], dict[str, int]]:
    root = options.history
    layout = validate(options)
    scope = "global_v1" if layout == "global" else options.character
    state_path = ".openchatlink/state.json"
    state_data = read(root, state_path)
    state = json.loads(state_data) if state_data is not None else {"schema": 1, "layout": layout, "sessions": {}}
    if state.get("schema") != 1 or state.get("layout") != layout:
        raise ValueError("Importer state schema or layout differs. Do not mix layouts in one history directory.")
    index_path = "global_v1/migration_v1.index"
    index_data = read(root, index_path) if layout == "global" else None
    entries = parse_index(index_data)
    changes, expected, mtimes = {}, {}, {}
    metadata_rows, summary_rows = [], []
    report = {"layout": layout, "created": 0, "updated": 0, "unchanged": 0, "skipped_empty": 0,
              "skipped_deleted": 0, "conflicts": [], "omitted_messages": 0, "backup": None}

    def change(path: str, data: bytes, old: bytes | None):
        if data != old:
            changes[path], expected[path] = data, old

    for conversation in read_conversations(options.database, options.sources, options.conversation_ids):
        report["omitted_messages"] += conversation.omitted
        if not conversation.messages:
            report["skipped_empty"] += 1
            continue
        sid = session_id(conversation)
        previous = state["sessions"].get(sid)
        entry = entries.get(sid)
        if entry and entry[8] == "1":
            report["skipped_deleted"] += 1
            continue
        if previous and previous["character"] != options.character:
            report["conflicts"].append({"session": sid, "reason": "character_changed"})
            continue
        if previous and layout == "global" and entry is None:
            report["conflicts"].append({"session": sid, "reason": "global_entry_missing"})
            continue
        path = f"{scope}/session_{sid}.chatv2"
        meta_path = f"{scope}/session_{sid}.meta"
        old, old_meta = read(root, path), read(root, meta_path)
        new = serialize(conversation, options.character, options.character_name)
        source_hash = digest(new)
        if previous:
            if old is None:
                report["skipped_deleted"] += 1
                continue
            if source_hash == previous["source_hash"] and conversation.title == previous["source_title"]:
                report["unchanged"] += 1
                continue
            if digest(old) != previous["history_hash"]:
                report["conflicts"].append({"session": sid, "reason": "local_history_changed"})
                continue
        elif old is not None or old_meta is not None or entry is not None:
            report["conflicts"].append({"session": sid, "reason": "unowned_session_collision"})
            continue
        new_meta = metadata(old_meta, conversation.title, options.character, options.character_name,
                            layout == "global", previous["source_title"] if previous else None)
        change(path, new, old)
        change(meta_path, new_meta, old_meta)
        metadata_rows.append(metadata_index_row(sid, new_meta))
        if new != old:
            summary_rows.append("1|D|" + encode(sid))
        mtimes[path] = conversation.updated_ms
        mtimes[meta_path] = conversation.updated_ms
        if layout == "global" and entry is None:
            entries[sid] = [sid, options.character, options.character_name, options.character,
                            options.character_name, "", "", "1", "0"]
        state["sessions"][sid] = {"character": options.character, "source": conversation.source,
                                   "external_id": conversation.identity, "source_hash": source_hash,
                                   "history_hash": digest(new), "source_title": conversation.title}
        report["updated" if previous else "created"] += 1
    if metadata_rows:
        metadata_index_path = f"{scope}/session_metadata.chatv2index"
        old_index = read(root, metadata_index_path)
        change(metadata_index_path, append_journal(old_index, metadata_rows), old_index)
        summary_index_path = f"{scope}/session_summary.chatv2summary"
        old_summary = read(root, summary_index_path)
        if old_summary is not None and summary_rows:
            # Cache keys use file size and mtime; equal-size edits within one second can match.
            change(summary_index_path, append_journal(old_summary, summary_rows), old_summary)
    if changes:
        if layout == "global":
            change(index_path, serialize_index(entries), index_data)
        # State is committed last. All preceding files are backed up in the same journal.
        change(state_path, json_bytes(state), state_data)
    return report, changes, expected, mtimes


def sync(options: Options, dry_run: bool = False, guard=require_stopped) -> dict:
    if dry_run:
        report, _, _, _ = plan(options)
        report["dry_run"] = True
        return report
    validate(options)
    guard()
    with locked(options.history):
        recover(options.history, guard)
        report, changes, expected, mtimes = plan(options)
        if changes:
            report["backup"] = transaction(options.history, changes, expected, mtimes, guard)
        report["dry_run"] = False
        return report
