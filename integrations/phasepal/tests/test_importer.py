"""Synthetic databases and temp directories only; never access a user's history."""
from contextlib import closing, redirect_stdout
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from openchatlink.cli import main
from openchatlink.files import (BusyError, atomic_write, locked, read, recover, require_stopped,
                               rollback, safe_path, transaction)
from openchatlink.format import decode, digest, encode, identifier, parse_index, serialize_index, session_id
from openchatlink.source import list_sources, read_conversations
from openchatlink.sync import Options, sync

REPO = Path(__file__).resolve().parents[3]


class ImporterTests(unittest.TestCase):
    def setUp(self):
        temporary_root = REPO / ".test-temp"
        temporary_root.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=temporary_root)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = self.root / "hstry.db"
        self.history = self.root / "direct_local_v1" / "ChatV2History"
        self.history.mkdir(parents=True)
        with closing(sqlite3.connect(self.db)) as db, db:
            # Use the actual upstream schema, not a guessed test table layout.
            db.executescript((REPO / "crates/hstry-core/migrations/001_initial_schema.sql").read_text(encoding="utf-8"))
            db.execute("INSERT INTO sources(id,adapter) VALUES ('chatgpt-web','chatgpt-web')")
            db.execute("INSERT INTO sources(id,adapter) VALUES ('chatgpt-web-team','chatgpt-web')")
            db.execute("INSERT INTO sources(id,adapter) VALUES ('codex','codex')")
        self.add_conversation("conv-1", "chatgpt-web", "external-1", "Reina | 日本語")
        self.session = session_id(read_conversations(self.db, ["chatgpt-web"], [])[0])
        self.options = Options(self.db, self.history, "avatar_1", "Reina")

    def add_conversation(self, cid, source, external, title):
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute("INSERT INTO conversations(id,source_id,external_id,title,created_at,updated_at) "
                       "VALUES (?,?,?,?,?,?)", (cid, source, external, title, 1720000000, 1720000100))
            for index, role, content in [(0, "system", "private setup"), (1, "user", "Hello\nReina | 🌸"),
                                         (2, "assistant", "こんにちは\tWelcome!"), (3, "tool", "tool result")]:
                db.execute("INSERT INTO messages(id,conversation_id,idx,role,content,created_at) VALUES (?,?,?,?,?,?)",
                           (f"{cid}-{index}", cid, index, role, content, 1720000000 + index))

    def sid(self):
        return self.session

    def path(self, scope="avatar_1", suffix=".chatv2"):
        return self.history / scope / ("session_" + self.sid() + suffix)

    def run_sync(self, dry=False):
        return sync(self.options, dry, guard=lambda: None)

    def update_source(self, text="Updated reply", title=None):
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute("UPDATE messages SET content=? WHERE id='conv-1-2'", (text,))
            if title is not None:
                db.execute("UPDATE conversations SET title=? WHERE id='conv-1'", (title,))

    def test_format_roles_unicode_timestamps_titles_and_idempotency(self):
        before = self.db.read_bytes()
        result = self.run_sync()
        self.assertEqual((result["created"], result["omitted_messages"], result["layout"]), (1, 2, "character"))
        lines = [line.split("|") for line in self.path().read_text(encoding="utf-8").splitlines()]
        self.assertEqual([(line[1], decode(line[3]), int(line[7])) for line in lines],
                         [("1", "Hello\nReina | 🌸", 1720000001000), ("2", "こんにちは\tWelcome!", 1720000002000)])
        self.assertEqual(len(lines[0]), 13)
        self.assertEqual(decode(lines[0][0]), f"ocl_{self.sid()}_1")
        self.assertEqual(decode(self.path(suffix=".meta").read_text(encoding="utf-8").splitlines()[0][6:]), "Reina | 日本語")
        self.assertEqual(self.path().stat().st_mtime_ns, 1720000100000000000)
        written = self.path().read_bytes()
        repeat = self.run_sync()
        self.assertEqual((repeat["unchanged"], repeat["backup"], self.path().read_bytes()), (1, None, written))
        self.assertEqual(self.db.read_bytes(), before)

    def test_dry_run_has_no_side_effects(self):
        result = self.run_sync(True)
        self.assertEqual(result["created"], 1)
        self.assertEqual(list(self.history.iterdir()), [])

    def test_global_index_keeps_other_sessions_and_adds_character_identity(self):
        global_dir = self.history / "global_v1"
        global_dir.mkdir()
        native = ["native-session", "other-avatar", "Other", "other-avatar", "Other", "", "", "1", "0"]
        (global_dir / "migration_v1.index").write_bytes(serialize_index({"native-session": native}))
        result = self.run_sync()
        index = parse_index((global_dir / "migration_v1.index").read_bytes())
        self.assertEqual(index["native-session"], native)
        self.assertEqual(index[self.sid()], [self.sid(), "avatar_1", "Reina", "avatar_1", "Reina", "", "", "1", "0"])
        self.assertEqual(result["layout"], "global")
        self.assertIn("global_home_id=" + encode("avatar_1"), self.path("global_v1", ".meta").read_text(encoding="utf-8"))

    def test_updates_are_atomic_and_keep_local_metadata(self):
        self.run_sync()
        meta = self.path(suffix=".meta")
        meta.write_text("title=" + encode("My renamed chat") + "\npinned=1\ncustom_flag=kept\n", encoding="utf-8")
        self.update_source(title="Changed in ChatGPT")
        result = self.run_sync()
        self.assertEqual(result["updated"], 1)
        self.assertEqual(meta.read_text(encoding="utf-8"), "title=" + encode("My renamed chat") + "\npinned=1\ncustom_flag=kept\n")
        self.assertIn(encode("Updated reply"), self.path().read_text(encoding="utf-8"))

    def test_updates_refresh_metadata_index_and_invalidate_only_owned_summary(self):
        self.run_sync()
        directory = self.path().parent
        summary = directory / "session_summary.chatv2summary"
        native = "1|U|" + encode("native") + "|1|1|1||\n"
        owned = "1|U|" + encode(self.sid()) + "|1|1|2||\n"
        summary.write_text(native + owned, encoding="utf-8")
        self.update_source(title="New source title")
        self.run_sync()
        metadata_row = (directory / "session_metadata.chatv2index").read_text(encoding="utf-8").splitlines()[-1].split("|")
        self.assertEqual((decode(metadata_row[2]), decode(metadata_row[3])), (self.sid(), "New source title"))
        self.assertEqual(summary.read_text(encoding="utf-8"), native + owned + "1|D|" + encode(self.sid()) + "\n")

    def test_local_edits_and_new_turns_are_never_overwritten(self):
        for local in (b"local appended turn\n", b"edited locally\n"):
            with self.subTest(local=local):
                self.history = self.root / local.decode().split()[0] / "ChatV2History"
                self.history.mkdir(parents=True)
                self.options.history = self.history
                self.update_source("Original")
                self.run_sync()
                self.path().write_bytes(self.path().read_bytes() + local)
                expected = self.path().read_bytes()
                self.update_source("Changed")
                result = self.run_sync()
                self.assertEqual(result["conflicts"], [{"session": self.sid(), "reason": "local_history_changed"}])
                self.assertEqual(self.path().read_bytes(), expected)

    def test_deleted_character_chat_is_not_resurrected(self):
        self.run_sync()
        self.path().unlink()
        self.update_source()
        self.assertEqual(self.run_sync()["skipped_deleted"], 1)
        self.assertFalse(self.path().exists())

    def test_global_tombstone_is_respected(self):
        self.options.layout = "global"
        self.run_sync()
        index_path = self.history / "global_v1/migration_v1.index"
        entries = parse_index(index_path.read_bytes())
        entries[self.sid()][8] = "1"
        index_path.write_bytes(serialize_index(entries))
        old = self.path("global_v1").read_bytes()
        self.update_source()
        self.assertEqual(self.run_sync()["skipped_deleted"], 1)
        self.assertEqual(self.path("global_v1").read_bytes(), old)

    def test_unknown_collisions_fail_closed(self):
        self.path().parent.mkdir()
        self.path().write_bytes(b"native history")
        result = self.run_sync()
        self.assertEqual(result["conflicts"][0]["reason"], "unowned_session_collision")
        self.assertEqual(self.path().read_bytes(), b"native history")

    def test_bad_index_has_no_history_writes(self):
        directory = self.history / "global_v1"
        directory.mkdir()
        (directory / "migration_v1.index").write_text("damaged")
        with self.assertRaisesRegex(ValueError, "damaged"):
            self.run_sync()
        self.assertFalse(self.path("global_v1").exists())

    def test_sources_and_conversation_filters_keep_accounts_separate(self):
        self.add_conversation("conv-team", "chatgpt-web-team", "external-1", "Team chat")
        self.assertEqual(len(list_sources(self.db)), 2)
        self.assertEqual(len(read_conversations(self.db, ["chatgpt-web"], ["external-1"])), 1)
        rows = read_conversations(self.db, ["chatgpt-web", "chatgpt-web-team"], [])
        self.assertEqual(len({session_id(c) for c in rows}), 2)
        with self.assertRaises(ValueError):
            read_conversations(self.db, ["codex"], [])
        with self.assertRaises(ValueError):
            read_conversations(self.db, ["chatgpt-web"], ["missing"])

    def test_read_only_wal_snapshot_includes_committed_changes(self):
        db = sqlite3.connect(self.db)
        self.addCleanup(db.close)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("UPDATE messages SET content='WAL reply' WHERE id='conv-1-2'")
        db.commit()
        self.assertEqual(read_conversations(self.db, ["chatgpt-web"], [])[0].messages[-1].text, "WAL reply")

    def test_rollback_restores_update_and_state(self):
        initial = self.run_sync()
        before = self.path().read_bytes()
        state = (self.history / ".openchatlink/state.json").read_bytes()
        self.update_source()
        update = self.run_sync()
        rollback(self.history, update["backup"], lambda: None)
        self.assertEqual(self.path().read_bytes(), before)
        self.assertEqual((self.history / ".openchatlink/state.json").read_bytes(), state)
        rollback(self.history, initial["backup"], lambda: None)
        self.assertFalse(self.path().exists())

    def test_rollback_refuses_later_local_changes(self):
        result = self.run_sync()
        self.path().write_bytes(b"local edit")
        with self.assertRaisesRegex(ValueError, "newer changes"):
            rollback(self.history, result["backup"], lambda: None)
        self.assertEqual(self.path().read_bytes(), b"local edit")

    def test_transaction_failure_rolls_back_and_preserves_unknown_files(self):
        target = "avatar_1/session_test.chatv2"
        other = self.history / "unrelated.txt"
        other.write_bytes(b"keep")
        original_write = atomic_write

        def fail_state(path, data):
            if path.name == "state.json" and data is not None:
                raise OSError("injected disk failure")
            original_write(path, data)

        with patch("openchatlink.files.atomic_write", side_effect=fail_state):
            with self.assertRaises(OSError):
                transaction(self.history, {target: b"new", ".openchatlink/state.json": b"{}"},
                            {target: None, ".openchatlink/state.json": None}, {}, lambda: None)
        self.assertIsNone(read(self.history, target))
        self.assertEqual(other.read_bytes(), b"keep")

    def test_pending_crash_recovery_is_idempotent(self):
        result = self.run_sync()
        journal = self.history / f".openchatlink/backups/{result['backup']}/journal.json"
        data = json.loads(journal.read_bytes())
        data["status"] = "pending"
        journal.write_text(json.dumps(data))
        recover(self.history, lambda: None)
        recover(self.history, lambda: None)
        self.assertFalse(self.path().exists())

    def test_running_application_prevents_writes(self):
        def busy():
            raise BusyError("running")
        with self.assertRaises(BusyError):
            sync(self.options, guard=busy)
        self.assertEqual(list(self.history.iterdir()), [])

    def test_lock_prevents_competing_importers(self):
        with locked(self.history):
            with self.assertRaises(BusyError):
                with locked(self.history):
                    self.fail("second importer acquired lock")

    def test_identifier_and_backup_paths_reject_traversal(self):
        for value in ("../avatar", "avatar/name", "CON", "name ", "x" * 129):
            with self.subTest(value=value), self.assertRaises(ValueError):
                identifier(value)
        with self.assertRaises(ValueError):
            safe_path(self.history, "../outside")
        with self.assertRaises(ValueError):
            rollback(self.history, "../outside", lambda: None)

    def test_linked_history_directory_is_rejected(self):
        link = self.root / "linked"
        try:
            link.symlink_to(self.history, target_is_directory=True)
        except OSError:
            self.skipTest("Host requires elevated permission to create test symlinks")
        with self.assertRaises(ValueError):
            safe_path(link, "test")

    def test_cli_json_preview_runs_without_installation(self):
        command = [sys.executable, str(REPO / "openchatlink.py"), "sync", "--hstry-db", str(self.db),
                   "--history-dir", str(self.history), "--character-id", "avatar_1", "--dry-run", "--json"]
        result = subprocess.run(command, capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout)["created"], 1)
        self.assertEqual(list(self.history.iterdir()), [])

    def test_cli_config_validation_and_missing_source(self):
        config = self.root / "config.json"
        config.write_text(json.dumps({"hstry_db": str(self.db), "sources": "chatgpt-web"}))
        stream = io.StringIO()
        with redirect_stdout(stream):
            code = main(["sources", "--config", str(config), "--json"])
        self.assertEqual(code, 1)
        self.assertIn("list", json.loads(stream.getvalue())["error"])

    def test_watch_waits_quietly_and_resumes_after_application_closes(self):
        stream = io.StringIO()
        normal = {"layout": "character", "created": 0, "updated": 0, "unchanged": 1,
                  "skipped_empty": 0, "skipped_deleted": 0, "conflicts": [],
                  "omitted_messages": 2, "backup": None, "dry_run": False}
        args = ["watch", "--hstry-db", str(self.db), "--history-dir", str(self.history),
                "--character-id", "avatar_1", "--json"]
        with patch("openchatlink.cli.sync", side_effect=[BusyError(), BusyError(), normal, normal]), \
                patch("openchatlink.cli.time.sleep", side_effect=[None, None, None, KeyboardInterrupt]), \
                redirect_stdout(stream):
            code = main(args)
        self.assertEqual(code, 130)
        events = [json.loads(line) for line in stream.getvalue().splitlines()]
        self.assertEqual(events, [{"waiting": True}, normal])

    def test_process_guard_detects_phase_pal_and_unity(self):
        for name in ("Phase Pal.exe", "PhasePal", "Unity.exe"):
            stdout = f'"{name}","123"\n' if os.name == "nt" else name + "\n"
            with self.subTest(name=name), patch("openchatlink.files.subprocess.run") as process:
                process.return_value.stdout = stdout
                with self.assertRaises(BusyError):
                    require_stopped()

    def test_source_deletion_does_not_delete_destination(self):
        self.run_sync()
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute("DELETE FROM conversations WHERE id='conv-1'")
        self.assertEqual(self.run_sync()["created"], 0)
        self.assertTrue(self.path().exists())


if __name__ == "__main__":
    unittest.main()
