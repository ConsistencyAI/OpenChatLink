# Security policy

## Supported versions

Security fixes target the latest code on `main`. The Phase Pal live-sync feature
is unreleased. Older development snapshots do not receive separate fixes.

## Report a vulnerability privately

Do not post vulnerabilities, chat histories, credentials, or connection codes in
public pull requests or discussions.

When available, use GitHub's **Security > Report a vulnerability** on this
repository: https://github.com/sobiesie/OpenChatLink/security/advisories/new.
If that option is unavailable, use a private contact method listed on the
maintainer's profile: https://github.com/sobiesie. Ask for a private reporting
channel before sending sensitive details. Do not post the details publicly.

Include the affected commit or version, operating system, source provider,
reproduction steps using synthetic data, expected behavior, and possible impact.
Remove all tokens, personal paths, and conversation content from attachments.
No response deadline or paid bounty is promised.

## Scope

Relevant concerns include unauthorized history access, pairing-code exposure,
loopback receiver authentication, unsafe local file access, and unintended writes
to source conversations. Report flaws in external services to their owners.
