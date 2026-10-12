# OpenChatLink for Phase Pal

This Chrome extension sends your personal ChatGPT conversations directly to
the running Phase Pal app. It needs no hstry-api server, Python script,
database path, or avatar-folder setup.

The Phase Pal application must include the live-sync integration in
`integrations/phasepal/phasepal-live-sync.patch`. An older installed build
does not have this setting or receiver.

1. Use Chrome 120 or later. Download this repository's source ZIP and extract it,
   or download the extension artifact from its GitHub Actions run. Keep the entire
   `phasepal-extension` folder in a stable location.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**,
   and select this folder. Keep the folder; moving it can change the extension ID.
3. Open Phase Pal, select the avatar that should receive the chats, and enable
   **Store Chat History**. In Chat Settings → General → **External Conversations**,
   enable **Sync personal ChatGPT conversations**.
4. Select **Copy connection code**. Open the extension, paste the code, and select
   **Connect**. Sign in to your personal account at `https://chatgpt.com`.
5. Chats now appear in Phase Pal's Chat History. The extension checks for changes
   every minute while Chrome and Phase Pal are running. Large imports continue
   in batches. **Sync now** runs a check immediately.

When you send a message in an imported chat, Phase Pal first creates a **local
copy** and continues there. A banner explains that those messages cannot sync
back to ChatGPT. Its options are **Open in ChatGPT** and **View synced original**.
The original stays separate and keeps receiving Chrome updates. You can also
select **Continue in Phase Pal** before sending, editing, or using voice.

Changing the avatar for new imports requires disabling sync, selecting the new
avatar, and enabling sync again. Copy the new connection code into the extension.
Previously imported chats and their local copies keep their existing owners.
Turning sync off in Phase Pal closes the receiver; **Disconnect** in the extension
stops browser collection and removes its saved connection.

Text and message timestamps are imported. Images, files, hidden system messages,
tool calls, saved ChatGPT memory, and custom GPT settings are not imported.
Phase Pal replies remain local and use its selected model/provider. The extension
does not submit messages or perform writes in ChatGPT.

Collection uses ChatGPT's internal browser endpoints through your signed-in
browser session. It is unofficial and may need an update after website changes.
Browser account credentials stay in Chrome; only conversation text and bounded
identity metadata go to the paired loopback receiver. Pairing credentials are
saved in Phase Pal's OS credential store and the extension's local storage.
Do not share connection codes or upload your personal state to this repository.

Run `node --test phasepal-extension/tests/*.test.js` from the repository root.
The original hstry collector and offline Python importer remain available in
their existing folders. See THIRD_PARTY_NOTICES.md and LICENSE for collector
provenance.

Sync checkpoints are stored between bounded collection passes so Chrome can
stop and restart its background worker. Each browser request has a 25-second
timeout. See [Chrome's service worker lifecycle documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
