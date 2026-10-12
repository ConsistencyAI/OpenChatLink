# Phase Pal live-sync integration

The Chrome extension talks directly to a receiver owned by Phase Pal's ChatV2
runtime. This source patch adds **External Conversations** to Chat Settings and
the banner used for synced originals and local copies. See the
[user setup](../../phasepal-extension/README.md).

The extension includes selected/all chats, all/last-100/date-limited history, and
automatic/manual scheduling. Version 0.4 requires the explicit provider field in
the current app contract. Use the current extension and app source together.
The app registry stores source identity separately from character assignment;
there is no migration for earlier unreleased imports. If the app patch is already
merged, update its source changes instead of applying the full patch again.

## Apply to Phase Pal

The patch was prepared against Phase Pal commit
`c8acaf445c7a780370b758d7e99c28c97f493d05` (Unity `6000.0.83f1`). From a compatible
Phase Pal source checkout, use the path to this OpenChatLink checkout:

```sh
git apply --check /path/to/OpenChatLink/integrations/phasepal/phasepal-live-sync.patch
git apply /path/to/OpenChatLink/integrations/phasepal/phasepal-live-sync.patch
```

Review the source changes and build the application through its normal platform
workflow. Let Unity create the new script `.meta` files; this patch does not
assign serialized GUIDs or change scenes. An existing installed Phase Pal binary
does not gain the setting by loading the extension alone.

The patch preserves the current history store, scoped runtime data directory,
submit coordinator, provider selection, and tool approval rules. Its detailed
contract is in the added `Phase Pal/Docs/OpenChatLinkIntegration.md`.

## Data and replies

- Pair once with a connection code stored through Phase Pal's OS credential store.
- Personal ChatGPT text history arrives on authenticated IPv4 loopback port 41771.
- One original exists per provider/account/conversation, regardless of character.
- Its home is assigned on first import. Changing the target affects new chats.
- Sharing changes chat visibility, without changing source IDs or assignments.
- Sending text creates an independent local copy before the existing submit flow.
- The local-copy banner offers **Open in ChatGPT** and **View synced original**.
- Voice and edit actions on the original require **Continue in Phase Pal** first.
- Deleted mirrors stay deleted. Unexpected local modifications cause a conflict.
- Saved ChatGPT memory, custom instructions, attachments, and model state are
  outside this history bridge. Phase Pal replies cannot be sent back through it.

## Verification

The initial four affected ChatV2 assemblies compiled with the available Unity
reference assemblies. The identity update compiled Platform and passed 22 managed
behavior cases with the real history stores and HTTP receiver, including different
character targets and shared visibility. Extension 0.4 passes 21 Node tests. The
earlier browser UI check used synthetic chat data. No Unity process was launched.
These checks do not prove Unity UI rendering or packaged-player behavior.

Live Chrome pairing, OS credential stores on each target platform, scene changes,
and the banner in a packaged player still need application QA. The collector uses
unofficial ChatGPT browser endpoints and can need updates when they change.
The upstream `just check-all` command could not run because `just` is unavailable
on this host. No Rust source was changed.

## License

The patch contains first-party Phase Pal source, tests, and documentation. It is
covered by [PHASEPAL_SOURCE_LICENSE](PHASEPAL_SOURCE_LICENSE), copied from the
Phase Pal source repository. It does not contain avatar assets, Unity packages,
compiled helpers, player builds, credentials, or personal conversations.
The extension's hstry-derived collector retains its adjacent MIT license.
