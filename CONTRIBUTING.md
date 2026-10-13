# Contributing to OpenChatLink

OpenChatLink connects selected conversation histories to Phase Pal. The live-sync
feature needs a compatible Phase Pal update; it is not yet released.

## Propose a change

Open a focused pull request against `main`. Explain the problem, the expected
behavior, and how you checked the change. Use a draft pull request for discussion
before a large change. Maintainers use `trx` for issue tracking.

Keep unrelated edits out of the pull request. Follow [AGENTS.md](AGENTS.md) for
source conventions. Do not add dependencies without explaining why they are needed.

## Check your work

Run the checks for the part you changed, from the repository root:

- Chrome extension: `node --test phasepal-extension/tests/*.test.js` and
  `node --check phasepal-extension/background.js` (Node.js 22).
- Offline importer: `python -m unittest discover -s integrations/phasepal/tests -v`
  (Python 3.11 or later).
- Rust: `cargo fmt --all --check` and `cargo test -p <changed-crate>`.

For extension changes, also describe any manual checks in Chrome and the Phase
Pal version used. Automated tests do not prove compatibility with live websites.

## Protect user data

Use synthetic chats and test accounts. Do not include real chat exports, browser
cookies, connection codes, credentials, local databases, or personal paths in
commits, screenshots, logs, or pull requests. Redact diagnostic output.
Keep source selection, consent, cancellation, and read-only source access intact.
Report vulnerabilities using [SECURITY.md](SECURITY.md).

## Licenses and releases

Keep upstream attribution and license notices. Most code uses the root MIT
license; the Phase Pal source patch has a separate license in
`integrations/phasepal/PHASEPAL_SOURCE_LICENSE`. Contributions must respect the
license of the files they change. Do not copy code or assets without permission.

Maintainers control releases. A pull request does not authorize publishing to
package registries, the Chrome Web Store, or upstream hstry distribution channels.
