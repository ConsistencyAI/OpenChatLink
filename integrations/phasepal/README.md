# OpenChatLink: hstry to Phase Pal

For the extension-first flow that syncs into a running app, use the
[Chrome extension](../../phasepal-extension/README.md). The
[Phase Pal source integration](LIVE_SYNC.md) adds the app setting and reply banner.
The database importer below is the offline fallback.

OpenChatLink imports selected ChatGPT conversations from this fork's hstry
SQLite database into Phase Pal's ChatV2 history. It runs locally with Python
3.11 or later and has no third-party Python dependencies.

```text
ChatGPT in Chrome -> hstry sync extension -> local hstry-api/database
                                            |
                                            v
                                  OpenChatLink importer
                                            |
                                            v
                                 Phase Pal ChatV2 history
```

This is a one-way text-history import. It does not connect to the original
ChatGPT conversation for inference, copy ChatGPT saved memory or custom GPT
configuration, or send Phase Pal replies back to ChatGPT. Configure Reina's
personality separately in Phase Pal. A model's context limit still applies.

## Set up the source

Use this checkout's [hstry instructions](../../README.md) to install hstry and
hstry-api. The importer can also read a database made by the same upstream
hstry version (0.5.27). It does not require compiling the Rust workspace.
The hstry browser collector does require a working hstry-api executable.
Upstream's prebuilt release binaries currently cover macOS and Linux; a Windows
collector may require building the Rust API separately.

1. Run `hstry api enable`, configure a local ingest token, and run `hstry api start`.
2. In Chrome, load this repository's `extension/` directory as an unpacked extension.
3. Set the extension's port and token to match hstry-api. Enable only the intended
   ChatGPT source and sign in to ChatGPT in Chrome. Run a sync from the extension.
4. Find the database path with `hstry config show`. The `database` setting is
   authoritative. Pass it explicitly if it differs from the default.

The extension uses ChatGPT's browser session and internal web endpoints. This
is an unofficial collector, separate from Phase Pal's ChatGPT Auth. It can stop
working after a ChatGPT website change. No ChatGPT token or browser cookie is
needed by the importer. As an alternative, import an extracted ChatGPT data
export using `hstry import <export-directory>`, then select that hstry source.

## Select the target

Start Phase Pal normally, enable **Store Chat History**, and save a short chat
with the intended avatar. Then close Phase Pal. Do not start Unity for this step
unless you already use the Editor.

Choose the **existing `ChatV2History` directory in the exact data scope you use**.
Steam Official, Steam Playtest, account scopes, and Direct (`direct_local_v1`)
can have different directories. Do not merge them or point at the unscoped
parent directory. The tool requires an explicit target and does not scan your
home folder or choose an account for you.

For character-scoped history, the immediate directory below `ChatV2History`
is the avatar's ID. For global history, read `global_home_id` from a session's
history `.meta` file: the value is UTF-8 Base64. For example:

```bash
python -c "import base64; print(base64.b64decode('BASE64_VALUE').decode('utf-8'))"
```

Use the installed avatar's ID, not the display name `Reina`. The importer does
not create or modify avatars. History `.meta` files are chat metadata, not
Unity asset `.meta` files.

## Preview and import

From the repository root:

```bash
python openchatlink.py sources --hstry-db /path/to/hstry.db --json
python openchatlink.py sync --hstry-db /path/to/hstry.db --history-dir /path/to/ChatV2History --character-id AVATAR_ID --character-name Reina --source chatgpt-web --dry-run --json
python openchatlink.py sync --hstry-db /path/to/hstry.db --history-dir /path/to/ChatV2History --character-id AVATAR_ID --character-name Reina --source chatgpt-web
```

Quote paths with spaces. The default source is exactly `chatgpt-web` (the
extension's personal/default source). Team/workspace and export sources must
be selected by their exact ID using `--source`; repeat it to select more than
one. Only ChatGPT adapters are accepted. Use repeated `--conversation-id` flags
to import selected conversations; otherwise all conversations in the selected
sources are imported. Source IDs remain part of the destination identity, so
an export and a browser source are separate imports. They are not implicitly
deduplicated across accounts or sources.

After import, restart Phase Pal, select Reina, open Chat History, and select the
imported chat before continuing. There is no automatic active-chat switch.

For repeated use, copy [the example configuration](../../examples/openchatlink.json)
to `openchatlink.local.json`, replace the paths and avatar ID, and run:

```bash
python openchatlink.py sync --config openchatlink.local.json --dry-run
python openchatlink.py watch --config openchatlink.local.json --interval 30
```

Paths in configuration are absolute (or expanded from `~`/environment variables),
not relative to the configuration file. Command-line options override config.
Watch polls only the local database. It waits while Phase Pal or Unity is
running, imports after they close, and reports only state changes. It does not
launch or close either app. Ctrl+C stops watch. SQLite WAL reads are supported.
If you prefer an installed command: `python -m pip install ./integrations/phasepal`.

## Layout and update behavior

`--layout auto` uses global storage only when `global_v1/migration_v1.index`
already exists; otherwise it uses the avatar directory. This preserves the
installed player's current storage behavior. `--layout global` is an explicit
opt-in for a compatible current build: creating the index enables Phase Pal's
canonical global store on its next startup. Do not force it on older builds.

The importer writes the 13-field, Base64-encoded ChatV2 message format. It keeps
user/assistant text, title, message order, timestamps, and character attribution.
hstry database timestamps are Unix **seconds**; Phase Pal message timestamps
are Unix **milliseconds**. File modification times retain conversation activity
times for history ordering. System/tool/empty messages are omitted. Images,
files, tool calls, and structured reasoning parts are not imported or executed.

Stable source-scoped session IDs and position-based message IDs make repeated
syncs idempotent. Upstream edits can replace an unchanged imported transcript.
If Phase Pal edits it or adds local turns, the importer skips external updates
to that chat and reports a conflict. A local title rename and pin state are
preserved. Deleted chats and global deletion tombstones are not resurrected.
Removing a conversation from hstry does not delete it from Phase Pal.

## Backups and recovery

Each write transaction saves original files and SHA-256 checksums under
`ChatV2History/.openchatlink/backups/<backup-id>/`. It commits history, metadata,
the global index when needed, and importer state through atomic file replacement.
Metadata journal entries are refreshed, and changed transcripts' summary caches
are invalidated without removing other sessions' cached data.
This is a multi-file transaction with rollback, not an OS-wide atomic swap.
An OS lock excludes other importers. Process checks block writes while Phase
Pal or Unity is running; keep the apps closed for the entire import because
they do not share the importer's lock.

The next sync rolls back an interrupted pending transaction before planning
new changes. Rollback refuses to overwrite any later local changes:

```bash
python openchatlink.py rollback BACKUP_ID --history-dir /path/to/ChatV2History
```

Restore backups from newest to oldest. Backups contain private conversation
text and are retained locally until you remove them. Use the same filesystem
permissions as your Phase Pal data. Linked paths/junctions, damaged global
indexes, unknown session collisions, and unsafe avatar IDs are rejected.
Never commit your database, configuration, history, or backups, even to a
private repository. No runtime logs contain conversation text or titles.

Exit codes: `0` success/preview, `1` configuration or operation failure,
`2` completed sync/preview with conflicts, `130` interrupted watch.

## Verification and provenance

Run `python -m unittest discover -s integrations/phasepal/tests -v` from the root.
Tests use the actual upstream SQLite schema and synthetic data in temporary
directories. They exercise writes, repeated syncs, Unicode, both layouts,
updates, conflicts, tombstones, WAL reads, rollback, crash recovery, locks, and
CLI previews. The GitHub workflow runs them on Windows, macOS, and Linux.

The format was inspected against Phase Pal source commit
`c8acaf445c7a780370b758d7e99c28c97f493d05`, specifically `ChatV2FileHistoryStore`,
`ChatV2GlobalHistoryStore`, and `ChatV2RuntimeCompositionService`. A live browser
sync and imported-chat continuation in a packaged Phase Pal player still need
verification with your installed build. No Unity process is launched by these tests.

OpenChatLink retains hstry's upstream source and MIT license. Its fork baseline
is `21d0fd8dec1cc29ae058a303c0d0164e4c1f513d`. No Phase Pal production source,
avatar assets, credentials, or personal conversations are copied into this repo.
