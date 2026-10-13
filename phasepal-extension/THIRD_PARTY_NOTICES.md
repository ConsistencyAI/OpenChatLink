The ChatGPT collector in providers/chatgpt.js, Claude collector in
providers/claude.js, and helpers in lib/common.js are
derived from byteowlz/hstry commit 21d0fd8dec1cc29ae058a303c0d0164e4c1f513d.
Source: https://github.com/byteowlz/hstry
Copyright (c) 2025 byteowlz. MIT license; see LICENSE.
The ChatGPT collector is restricted to personal accounts. Claude selection is
scoped by organization. Claude changes add bounded passes, cancellation, selected
chat filtering, visible-text filtering, and active-branch selection.
Changes add bounded checkpoints, request cancellation/timeouts, personal-account
title discovery, selected-chat filtering, and filtering for visible text.
The Phase Pal receiver and interface are separate first-party
source in integrations/phasepal/phasepal-live-sync.patch; that patch is covered
by integrations/phasepal/PHASEPAL_SOURCE_LICENSE.

The locally bundled Montserrat Latin font in assets/montserrat-latin.woff2
comes from the referenced Phase Pal website's next/font Google Fonts output.
Copyright 2024 The Montserrat.Git Project Authors.
Source: https://github.com/JulietaUla/Montserrat
SIL Open Font License 1.1; see assets/Montserrat-OFL.txt.
The Phase Pal logo in assets/phase-pal-logo.svg is the current website's
phase-pal-v2-bunny-outline.svg brand asset, reused for this first-party
integration at the owner's request.

The source marks in assets/openai.svg, assets/claude.svg, assets/codex.svg,
and assets/claudecode.svg come from Lobe Icons.
Source: https://github.com/lobehub/lobe-icons
Revision: 05a9b8c41e4735a4a2b6d2f1e43574bd8ec6c8cb.
Copyright (c) 2023 LobeHub. MIT license; see assets/Lobe-Icons-LICENSE.txt.
The marks identify supported products; their trademarks belong to their owners.
