# OpenChatLink Privacy Policy

Effective date: October 29, 2026

Consistency AI, LLC provides OpenChatLink for Phase Pal. This policy covers the
Chrome extension and its connection to the Phase Pal desktop app for importing
conversation history. Its purpose is to bring the conversations you choose from
ChatGPT, Claude, local Codex, and Claude Code into Phase Pal.

Other Phase Pal features, including AI replies, voice, and cloud services, are
covered by the [Phase Pal Privacy Policy](https://www.phasepal.com/privacy-policy).
The optional hstry tools and offline importer in this repository are outside the
scope of this extension policy.

## Data OpenChatLink handles

- **Conversation data:** source and account or organization identifiers,
  conversation identifiers, titles, timestamps, and visible user and assistant
  message text. Messages can contain personal information that you or the source
  assistant included in a conversation.
- **Authentication data:** your existing signed-in browser session and a
  ChatGPT access token held in memory are used to read your web conversations. A
  separate Phase Pal connection code contains the local connection port and a
  secret pairing token. Website session credentials are not sent to Phase Pal
  or to the OpenChatLink developers.
- **Settings and operational data:** chosen sources and chats, history filters,
  message-selection fingerprints, sync schedules, progress checkpoints, sync
  status, a bounded list of recent sync activity, and your theme preference.

The extension does not request your website password. It does not collect your
general browsing history, record keystrokes, or monitor activity on other sites.

## When data is read and imported

To import conversations, you enable External Conversations and Store Chat
History in Phase Pal, pair the extension, and save your source and chat choices.
You can select individual chats or explicitly choose all chats for a source.

Loading a chat list reads titles and related identifiers so you can make a
selection. Previewing or syncing a chosen web chat can retrieve its full source
transcript before applying your history and message filters. Source responses
can contain extra metadata that is not included in the imported transcript.
The transfer to Phase Pal includes the selected visible message text and the
metadata needed to identify and update the conversation. The imported history
excludes attachments, hidden reasoning, system instructions, tool execution,
saved memory, and assistant configuration.

Phase Pal reads local Codex and Claude Code history files on your device. The
extension requests local titles or previews from Phase Pal and saves your import
choices; it does not have direct access to your filesystem. Source histories
are not changed, and replies made in Phase Pal are not written back to the
original source.

## Where data goes

The extension connects to `chatgpt.com` and `claude.ai` over HTTPS using your
existing sign-in. Those services process requests under their own privacy
policies. Chosen web histories are transferred to the Phase Pal app on your own
device through `http://127.0.0.1` using the secret pairing token. This local
connection uses HTTP, not TLS, and is not a remote cloud endpoint.

The extension does not upload conversation histories to an OpenChatLink server,
an advertising service, or an analytics service. It does not provide the
developers with remote access to your chats. We do not sell data handled by
OpenChatLink or use it for advertising, model training, credit decisions,
lending, or purposes unrelated to importing and managing your chosen histories.

If you continue an imported chat in Phase Pal, the app creates a separate copy.
Using a cloud or custom AI provider can send that copy's conversation context to
the provider you select. That processing is separate from the extension's
history transfer and is governed by Phase Pal's settings and privacy policy,
and the selected provider's policy.

OpenChatLink's use and transfer of user data comply with the Chrome Web Store
User Data Policy, including its Limited Use requirements.

## Storage and retention

The extension keeps its pairing code, settings, selected chat titles and
identifiers, message-selection fingerprints, checkpoints, and status in
`chrome.storage.local` on your device. This storage is not Chrome Sync storage.
The recent activity list is limited to 100 entries per source. Full message
transcripts are processed in memory for previews and transfer; the extension
does not save them as its own persistent transcript archive. The Phase Pal app
stores its pairing credential through its OS credential-store service.

Imported histories are stored separately in Phase Pal. They remain there until
you delete them through the app's history controls. Removing a chat from the
source, deselecting it, disconnecting the extension, or uninstalling the extension
does not delete the imported history or any separate copies in Phase Pal.

## Your controls and deletion

- Choose sources, conversations, history limits, and manual or automatic sync in
  the extension. Deselecting a chat stops future updates and keeps its existing
  import.
- Select **Disconnect** to stop browser sync and remove the extension's pairing
  code and browser sync checkpoints. Saved selections and some local settings
  remain. Disconnect also asks Phase Pal to pause local collection. If Phase Pal
  cannot confirm the pause, disable **External Conversations** in Phase Pal.
- Disable **External Conversations** or **Store Chat History** in Phase Pal to
  stop its external history collection. Local collection can otherwise continue
  while Phase Pal runs, even after Chrome closes.
- Uninstall the extension to remove its Chrome-local extension storage. Stop
  local collection in Phase Pal separately. Delete imported chats and their
  separate copies in Phase Pal if you no longer want them.
- Manage original conversations and browser sign-in through the source service.
  OpenChatLink does not delete those conversations or your source accounts.

Keep connection codes private. Someone who obtains a valid pairing token could
use it to access the local bridge while it is available. Do not put connection
codes or private chat histories in public GitHub issues or pull requests.

## Contact and changes

For privacy questions or requests, contact Consistency AI, LLC at
[hello@consistencyai.net](mailto:hello@consistencyai.net). If you contact us, we use
the information you choose to provide to respond to your request. Do not send
passwords, pairing codes, or conversation histories unless needed and explicitly
requested through a private support channel.

We will update this policy when OpenChatLink's data practices change. The
effective date above identifies this version.
