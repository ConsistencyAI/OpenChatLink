The ChatGPT collector in providers/chatgpt.js and helpers in lib/common.js are
derived from byteowlz/hstry commit 21d0fd8dec1cc29ae058a303c0d0164e4c1f513d.
Source: https://github.com/byteowlz/hstry
Copyright (c) 2025 byteowlz. MIT license; see LICENSE.
The collector is restricted to personal ChatGPT accounts in this extension.
Changes add bounded checkpoints, request cancellation/timeouts, personal-account
title discovery, selected-chat filtering, and filtering for visible text.
The Phase Pal receiver and interface are separate first-party
source in integrations/phasepal/phasepal-live-sync.patch; that patch is covered
by integrations/phasepal/PHASEPAL_SOURCE_LICENSE.
