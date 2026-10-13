# OpenChatLink

Sync ChatGPT, Claude web, local Codex desktop/CLI, and Claude Code conversations
into Phase Pal. The Chrome extension selects the sources, chats, history window,
and sync schedule. Phase Pal reads the selected local histories itself.

## Installation for Phase Pal

Use Chrome 120 or later and a Phase Pal build with the
[live-sync integration](integrations/phasepal/LIVE_SYNC.md). This feature is
unreleased. Loading the extension does not update an older installed app.

1. Download this repository with **Code > Download ZIP** and extract it.
2. Keep the complete `phasepal-extension` folder in a stable location.
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
   and select `phasepal-extension`.
4. In Phase Pal, select the home character for new chats and enable **Store Chat
   History**. In **Chat Settings > General > External Conversations**, enable sync.
5. Copy the connection code into the extension and connect.
6. Choose a source, load its chat list, and select specific chats or all chats.
7. Choose all history, the last 100 messages, or messages on/after a date. Save
   automatic or manual scheduling separately for each source.

Live sync needs no Homebrew, Arch package, Rust/Cargo build, hstry server, or
Python script. Read the [complete extension guide](phasepal-extension/README.md)
for sync timing, character sharing, local copies, and source limits.

## Phase Pal source integration

App developers can use the [integration guide](integrations/phasepal/LIVE_SYNC.md)
and `integrations/phasepal/phasepal-live-sync.patch`. The extension and updated
application source must be used together.

## Optional offline importer

The [offline importer](integrations/phasepal/README.md) copies selected ChatGPT
chats from a hstry SQLite database while Phase Pal is closed. That separate flow
uses Python 3.11 or later. Run `python openchatlink.py --help` from this checkout.

The retained hstry CLI, TUI, MCP, API, database, and original `extension/` folder
have their own [upstream guide](docs/UPSTREAM_HSTRY.md). The Phase Pal live-sync
extension is in `phasepal-extension/`.

## Attribution and license

OpenChatLink is based on [hstry](https://github.com/byteowlz/hstry). Its source and
collector attribution are retained under the [MIT license](LICENSE).
The Phase Pal source patch uses the separate
[Phase Pal source license](integrations/phasepal/PHASEPAL_SOURCE_LICENSE).
