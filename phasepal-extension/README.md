# OpenChatLink for Phase Pal

Import ChatGPT, Claude web, local Codex desktop/CLI, and Claude Code chats into
Phase Pal. The extension configures all four sources. Local reading runs inside
Phase Pal, so no extra helper, hstry server, or Python script is needed.
Use the current extension and app source patch together. This integration is
unreleased and has no migration for earlier development imports.

1. Download this repository's source ZIP, extract it, and keep the complete
   `phasepal-extension` folder in a stable location. Use Chrome 120 or later.
2. Open `chrome://extensions`, enable Developer mode, select Load unpacked,
   and choose that folder.
3. In Phase Pal, select the character for new chats and enable Store Chat History.
   Open Chat Settings > General > External Conversations and enable external sync.
4. Copy the connection code. Click the extension icon, paste the code, and connect.
5. Choose a source. Sign in to ChatGPT or Claude for web chats. Select Load / refresh
   chats, choose conversations, or explicitly choose all. Nothing imports by default.
6. Choose all history, last 100 messages, or messages on/after a date (00:00 UTC).
7. Save automatic or manual scheduling. In manual mode, select Sync now.
   Repeat these choices independently for each source.

Web sources check once per minute with Chrome and Phase Pal running. Local sources
check about every five seconds while Phase Pal runs, even after Chrome closes.
Large manual imports finish in bounded continuation passes. Imported chats appear
in the normal Phase Pal Chat History panel.

ChatGPT imports personal accounts only. Claude selections are organization-scoped;
choosing all includes all organizations available to the signed-in browser account.
Loading titles does not import message bodies. Deselected chats stop updating but
stay in Phase Pal. A nonempty history window can shorten an original. Chats with
no matching text are skipped. Local copies retain their own history.

There is one original per source/account/conversation. Its home is assigned on
first import. To change the destination for new chats, disable sync, select a
character, enable sync, and reconnect. Existing originals keep their home and do
not duplicate when reimported through another character. Share chats between
characters changes visibility, without changing import choices or identity.

Sending a message creates a local copy first. The banner explains that changes
cannot sync back and offers View synced original. Web sources also offer Open in
ChatGPT/Claude. Continue in Phase Pal prepares the copy before voice or edits.
New replies use Phase Pal's selected model/provider. The bridge never writes back
to the source app or resumes a Codex/Claude Code execution session.

Local Codex JSONL histories come from `sessions` and `archived_sessions` under
`CODEX_HOME` (default `~/.codex`). Claude Code reads `projects` under
`CLAUDE_CONFIG_DIR` (default `~/.claude`). Set these environment variables before
Phase Pal starts if you use another location. Remote-only or compressed histories
are outside this reader. Titles use the first visible user message. Linked paths
and Claude Code subagent folders are skipped. Limits are 10,000 files/directories,
64 MiB per file, and 20,000 visible messages per chat. The app reports read failures
or size limits in External Conversations. Source files are never changed.

Disconnect pauses local collection and stops browser collection. Turning sync off
or disabling Store Chat History in Phase Pal stops both. Saved selections remain.

Only visible user/assistant text and timestamps are imported. Attachments, hidden
reasoning, system instructions, tool execution, saved memory, and assistant
configuration are excluded. Browser credentials stay in Chrome. Pairing uses
Phase Pal's OS credential store and extension-local storage. Do not share codes.
Web collection uses unofficial browser endpoints and can need updates when sites
change. This is a history bridge, rather than a source continuation API.

The app must contain [the live-sync integration](../integrations/phasepal/LIVE_SYNC.md).
An older installed binary does not gain these features by loading the extension.
Run `node --test phasepal-extension/tests/*.test.js` from the repository root.
See LICENSE and THIRD_PARTY_NOTICES.md for hstry collector provenance.
The offline Python importer remains a separate ChatGPT-only fallback.
