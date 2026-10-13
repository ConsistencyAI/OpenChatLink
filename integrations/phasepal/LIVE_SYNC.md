# Phase Pal live-sync integration

Extension 0.5 configures ChatGPT, Claude web, local Codex desktop/CLI, and Claude
Code imports. Browser collection runs in Chrome. Phase Pal owns the local JSONL
reader and checks opted-in histories about every five seconds. Each source has
its own chat selection, history window, and automatic/manual schedule.
See [user setup](../../phasepal-extension/README.md).

## Apply to Phase Pal

Use the current extension and application source together. The integration is
unreleased; registry schema 2 has no migration for earlier development imports.
The full patch is based on Phase Pal commit
`c8acaf445c7a780370b758d7e99c28c97f493d05` (Unity `6000.0.83f1`).

```sh
git apply --check /path/to/OpenChatLink/integrations/phasepal/phasepal-live-sync.patch
git apply /path/to/OpenChatLink/integrations/phasepal/phasepal-live-sync.patch
```

If already merged, update the source changes instead of applying the full patch
again. Build through the normal platform workflow. Let Unity create new `.meta`
files; the patch does not assign GUIDs, alter scenes, or bundle dependencies.
Loading the extension alone does not update an installed Phase Pal binary.

## Behavior

- One protected original per provider/account/conversation, with separate home
  assignment. Changing the pairing target affects new chats.
- Sharing changes visibility; it does not change sync choices or source identity.
- History rows and the chat header show Phase Pal or the imported source, with
  Synced/Local copy labels. Badges use conversation ownership rather than model
  selection, and follow the current theme and active-history-row colors.
- Sending text creates an independent local copy through the existing submit flow.
- Banners name the source and offer View synced original; web sources also offer
  Open in ChatGPT/Claude. Voice and edits require Continue in Phase Pal first.
- Deleted originals stay deleted; unexpected local changes cause conflicts.
- Local readers never change source files or execute tools. No model state,
  saved memory, assistant configuration, or hidden reasoning is transferred.
- Host shutdown, sync disable, and history-consent revocation stop local work.
  Disconnect in the extension pauses local collection as well as web collection.

The full contract, source paths, limits, and lifecycle are in the patched
`Phase Pal/Docs/OpenChatLinkIntegration.md`. No server, local helper process,
Python script, hstry database, or additional Unity package is required.

## Verification

Two agent review rounds covered application sync, the extension, and UI integration.
Fixes passed 54 managed cases, 34 Node cases, and the existing 25 offline Python
cases. They cover registry recovery, failed preference writes, malformed local
records, failed-chat continuation, delayed credentials, offline disconnect, slow
catalog pages, and edits during long imports.

The current app worktree compiled in the already-open Unity Editor with no console
errors. Direct fixture calls passed 21 projection, deferred-refresh, and source-badge
cases, using real UXML/USS for the badge checks. No new Editor, Play Mode, build,
or Test Runner was started, and no personal chats were accessed. Live website
behavior, OS secret stores on each platform, and packaged-player layout remain
separate checks. The updated full patch applies to its declared base.
Upstream `just check-all` is unavailable on this host; no Rust code was changed.

## License

The patch contains first-party Phase Pal source, tests, and documentation under
[PHASEPAL_SOURCE_LICENSE](PHASEPAL_SOURCE_LICENSE). It contains no avatar assets,
compiled helpers, builds, credentials, or personal conversations. The hstry-derived
ChatGPT/Claude collectors retain the adjacent MIT license and provenance notice.
