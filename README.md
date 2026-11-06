# OpenChatLink

Sync ChatGPT, Claude web, local Codex desktop/CLI, and Claude Code conversations
into Phase Pal. The Chrome extension selects the sources, chats, history window,
and sync schedule. Phase Pal reads the selected local histories itself.

## Install the Chrome extension

**[Install OpenChatLink from the Chrome Web Store](https://chromewebstore.google.com/detail/openchatlink-for-phase-pa/ghcddonakbfdhhdokmcchahilcakphdi)**

Open the listing, click **Add to Chrome**, then confirm **Add extension**.

## Installation for Phase Pal

You need **Chrome 120 or later** and a Phase Pal build with **External
Conversations** support. **Phase Pal 2.0.20 is not supported.** Loading the
extension does not update the app.

1. Install OpenChatLink from the Chrome Web Store link above.
2. In Phase Pal, select the character for new chats and enable **Store Chat
   History**. Open **Chat Settings > General > External Conversations** and enable sync.
3. Copy the connection code. Open OpenChatLink from Chrome's Extensions menu,
   paste the code, and click **Connect**.
4. Choose a source. For web chats, sign in to ChatGPT or Claude in Chrome.
   Load the chat list and select specific chats or all chats.
5. Choose how much history to import and manual or automatic sync, then click
   **Save sync options**. Reviewing individual messages is optional.
6. For manual sync, click **Sync now**. Keep Chrome and Phase Pal open during web
   sync. Your imported chats appear in Phase Pal's chat history.

Chrome manages updates for the store installation. For local development builds,
see [development installation](phasepal-extension/README.md#development-installation).

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

## Contributing and security

Read the [contribution guide](CONTRIBUTING.md) and
[community rules](CODE_OF_CONDUCT.md) before opening a pull request.
Report vulnerabilities privately using the [security policy](SECURITY.md).

## Attribution and license

OpenChatLink is based on [hstry](https://github.com/byteowlz/hstry). Its source and
collector attribution are retained under the [MIT license](LICENSE).
The Phase Pal source patch uses the separate
[Phase Pal source license](integrations/phasepal/PHASEPAL_SOURCE_LICENSE).
