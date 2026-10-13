# OpenChatLink compatibility audit — 2026-10-13

Result: one confirmed submit regression was fixed. All 629 distinct fixture cases
in the selected compatibility matrix passed after the fix and harness repairs.
This is source and service-level evidence in the existing Editor. It is not a
standalone player or live user-flow qualification.

## Scope and baseline

- Windows Editor 6000.0.83f1, already open and outside Play Mode.
- Main worktree: `codex/oss-explore-product-simplification`; inspected HEAD
  `cd1959f41`, with the existing uncommitted OpenChatLink changes present.
- Review window: 2026-09-29 through 2026-10-13. Compare the current code with the
  fixes for shared/captured session ownership (`fdb8dd721`), latest history
  selection (`886e606d8`), restored history and provider switching (`8c58295d7`,
  `de5519d1b`), and API-key drafts (`2da599ba0`).
- The earlier representative Gemini-to-ChatGPT checks are recorded in
  `Phase Pal/Docs/LegacyGeminiChatChatGptVerification-20261010.md` in the Phase Pal checkout.
  This audit does not count their results as current passes or repeat live inference.
- Synthetic histories, fake providers, and test-owned temporary roots only.
  No existing user chat or source history was read or modified. No live model
  request, new Editor process, Test Runner session, or player build was started.
  Fixtures with provider preference scopes restored their saved values.
  Two local-notice tests that delete a real preference were excluded.

## Confirmed regression and fix

`SubmitTextAsync` called the external-copy preparation hook before activation
checks and locally handled commands. A research action or `/compact` could
therefore create and open an unnecessary copy before its existing handler ran.
That changed the target of a control action and could interrupt normal command
behavior on an imported original.

The hook now runs after those early handlers and before the submit target is
captured. Control handlers keep their existing target. A normal conversation
submit still captures the writable copy, while a native chat keeps its target.

The existing research and compaction tests failed with the hook installed before
the fix, then passed after it. Two new parameterized submit cases check the
native and copy target. Four new history cases check native persistence with
character/global stores and either a working import registry or a broken one.

## Compatibility matrix

| Area | Evidence and result |
| --- | --- |
| Existing native history | Native IDs remain writable before registry initialization and after a registry load error. Imports and copies retain native replies, image references, title and pin state. Native continuation and removal still persist. |
| Legacy history and newest chat | File history cases cover collision migration, restart, retained backups, legacy metadata and latest selection independently of pin/manual order. |
| Provider switching and old images | The actual request/transport path with fake Gateway services keeps user and assistant text, saved memory and history. Invalid or unsupported old images use request-only markers; saved records remain intact. New invalid images reject before dispatch. |
| Character sharing | History cases retain the canonical chat and captured home/turn ownership. External cases update one original across characters and keep independent copies. Turning sharing off changes visibility, not source identity. |
| Submit, edit, reload and voice | Selected coordinator cases cover control handlers, duplicate admission, navigation during preflight, rollback after failed writes, background completion and captured voice/screenshot targets. |
| Sync write protection | Synced originals reject native edits/appends and incoming messaging routes. Copies remain writable. Retry, deletion, conflict, account separation, failed registry commits and cancelled imports retain ownership. |
| Live source refresh | Host cases defer refresh while attachments are pending and discard it after selection changes. Source inspection also checks the preparing-upload gate. |
| Settings and presentation | Actual UI assets load. API-key drafts survive repeated refresh and reveal changes, and do not leak across provider/rebind changes. Native rows have no origin icon; imported rows and headers retain the correct source/status. Spinner state and disposal pass. |

## Current fixture results

Assertions were invoked directly through MCP in the existing Editor, with each
fixture's setup/cleanup where required. Async work was awaited with a timeout.
Parameterized source cases were expanded explicitly. These are direct fixture
results, not Unity Test Runner XML or standalone runtime results.

| Fixture | Distinct passed cases |
| --- | ---: |
| ChatV2AgentGatewayTransportTests | 322 |
| ChatV2ExternalConversationProjectionServiceTests | 11 |
| ChatV2ExternalConversationTests | 59 |
| ChatV2FileHistoryStoreTests | 74 |
| ChatV2ProviderRequestContextServiceTests | 26 |
| ChatV2RuntimeHostTests | 11 |
| ChatV2SessionHistoryServiceTests | 48 |
| ChatV2SubmitCoordinatorTests | 65 |
| Selected ChatV2ToolkitShellAssetTests | 13 |
| **Total** | **629** |

Counts use the union of fully qualified method/argument identities. Repeated
attributes and reruns are not counted again. No final assertion failure remains
in this matrix.

The first pass had two attachment-cleanup fixture failures while writing PNGs
under long Windows temporary paths. Those cases passed when their test roots
were shortened inside `BuildArtifacts/audit/`. Artifact path code was not changed.
Long production data paths remain a separate Windows qualification limit.

Nine cases initially stopped at `LogAssert.Expect` because direct invocation had
no test log scope. They were rerun with an isolated Unity log scope; assertions
and expected-log checks passed. One preliminary scoped harness stopped after its
first completed case; the remaining cases completed in a separate run. The final
check found no active audit log scope, compilation, or Play Mode session.

Ignored evidence is in `BuildArtifacts/OpenChatLinkUi/`: the pre-fix command
reproduction, initial fixture pass, post-fix pass, scoped reruns, expanded source
cases and `compatibility-audit-final.json`. The combined JSON contains the 629
final case outcomes. Scoped source diffs passed `git diff --check`.

## Remaining release checks

This audit cannot prove the affected user's private chat or an installed build.
Before release, check these flows in a candidate player with synthetic data:

1. Reopen an old Gemini/native chat with sync off, enable sync, continue through
   ChatGPT, restart, and verify replies, images, title and latest selection.
2. Sync a selected web chat while a native turn is active. Confirm that it does
   not change that turn's target, composer or provider selection.
3. Continue an original with an attachment, including an upload still preparing.
   Navigate or change character during copy creation and verify ownership.
4. Toggle sharing, switch characters and providers, then test text, voice, edit,
   reload, native commands and background completion.
5. Check spinner/toast/audio behavior and long Windows data paths in the packaged
   app. Run the same essential history checks on macOS and Linux.

No scene, provider secret, installed chat file or release availability was changed
by the audit fix. Unrelated worktree changes were retained.
