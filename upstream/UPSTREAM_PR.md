# Contributing Kourier to oh-my-pi

This repository keeps proposed first-party catalog contributions isolated from the installable extension. Target repository: `can1357/oh-my-pi`.

## Proposed changes

1. Add `rules/auth/kourier.kdl` from `upstream/rules/auth/kourier.kdl` to `packages/catalog/src/compat/rules/auth/` and register it in the auth-rule catalog if the catalog uses an explicit manifest.
2. Add `kourierDescriptor` from `upstream/catalog/kourier-descriptor.ts` to `packages/catalog/src/provider-models/`, then register it using the existing provider descriptor aggregation pattern.
3. Include a provider/API compatibility test for `openai-completions`, model id `deepseek-v4.1-flash`, multimodal input, context/output limits, zero-cost metadata, and reasoning effort levels.
4. Add auth coverage for validated API-key setup and document the optional native extension's agent identity and PKCE login flows.

## Review notes

- API base: `https://api.kourier.sh/v1`.
- Auth service: `https://app.kourier.sh`.
- The endpoint's live model list should remain authoritative for available model IDs; the descriptor gives a deterministic fallback for the primary model.
- Confirm the first-party OAuth client registration and auth policy grammar against maintained upstream conventions before merging. Do not ship an unregistered PKCE client id from the standalone extension as an upstream default.

## Suggested validation

Run the catalog and compatibility-rule tests, then exercise `/login kourier`, dynamic model refresh, and a text/image request against a test account before merging. This document is contribution guidance, not evidence that upstream changes were submitted.
