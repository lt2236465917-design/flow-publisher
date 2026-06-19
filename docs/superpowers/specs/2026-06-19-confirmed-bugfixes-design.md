# Confirmed Bug Fixes Design

Date: 2026-06-19

## Scope

This design covers the first repair batch approved after the repository audit:

1. Enforce secure transport for API and upload traffic.
2. Harden Electron navigation, window creation, permissions, and IPC sender validation.
3. Restrict renderer-accessible local files to explicitly authorized media.
4. Make scheduled publishing safe against whole-flow retries and duplicate submissions.
5. Validate account, record, and platform relationships at IPC boundaries.
6. Fix renderer IPC listener cleanup.
7. Bound data-URL decoding and persistent cover storage.
8. Add regression tests for the repaired behavior.

Publishing remains API/HTTP-only. Login windows and hidden signing contexts may load platform pages, but no repair may fill creator-center forms, upload through UI file inputs, or click publish controls.

The following are intentionally deferred to a separate high-risk batch:

- Major-version Electron and build-tool upgrades.
- Rewriting Git history to remove the previously committed captured payload.

The tracked captured payload will be removed from the current tree and ignored in this batch. Revoking any associated live platform session remains an operational action for the repository owner.

## Approach

Use narrow security helpers and explicit state transitions instead of large adapter rewrites.

- Pure helpers will define URL, sender, path, and payload validation so they can be tested without launching Electron.
- IPC handlers will reject invalid relationships before creating records, reading cookies, or making network requests.
- Scheduled publishing will create one publish record per platform attempt and resume from persisted upload metadata. It will never retry the complete upload-and-submit operation after submission begins.
- Transport security will default to certificate validation. Insecure remote HTTP endpoints and `rejectUnauthorized: false` will be removed. Loopback HTTP remains allowed for the local signer.

## Electron and IPC Security

### Trusted renderer origins

The main application window may load only:

- The packaged renderer file.
- The configured development renderer origin while in development.

The main window will:

- Deny unexpected navigation.
- Deny renderer-created windows.
- Deny permission requests by default.

Login and signer windows use separate sessions and do not receive the main preload bridge. Their navigation is restricted to HTTPS platform origins required by their platform flow. Loopback URLs are allowed only for the managed signer service itself, not as general remote navigation.

Every privileged IPC handler will verify that its sender is the main application renderer. Validation will occur before processing arguments. This applies to account, publishing, scheduling, analytics, file, and app-version handlers.

### IPC listener lifecycle

The preload bridge will retain the wrapper function passed to Electron and remove that exact wrapper during unsubscribe. This prevents listeners from accumulating across React mount/unmount cycles.

## File Access

The renderer must not be able to request arbitrary files under the user home directory.

An in-memory authorization registry in the main process will contain paths obtained through:

- The video file picker.
- The image file picker.
- Electron drag-and-drop `webUtils.getPathForFile`, registered through a dedicated validated IPC call.
- App-generated frame and cover paths.

Read, probe, validation, frame extraction, upload, cover upload, and scheduling operations will accept only authorized paths or app-owned paths under `userData` and the app-specific temporary directories.

Canonical paths will be used to prevent symlink and path-prefix bypasses. The `local-file` protocol will be restricted to authorized/app-owned files rather than the whole home directory.

Data URLs will be checked before and after base64 decoding. Only JPEG, PNG, WebP, BMP, and GIF will be accepted. Decoded image data is limited to 50 MB.

## Transport Security

TLS certificate validation will be enabled for all HTTPS API and CDN requests.

- Remove permissive HTTPS agents and `rejectUnauthorized: false`.
- Remove `ignoreHTTPSErrors: true` from browser contexts.
- Keep `bypassCSP` only where a signing implementation demonstrably requires it; it does not weaken TLS and must not be used by the main renderer.
- Kuaishou OpenAPI upload endpoints returned by the platform must be parsed and validated. HTTPS is required. A plain HTTP endpoint will fail with a precise transport-security error rather than uploading.
- The public IP-location fallback will use HTTPS.
- Loopback HTTP is allowed only for `127.0.0.1`, `localhost`, or `::1` signer endpoints.

No automatic downgrade to insecure HTTP or disabled certificate validation is permitted.

## Publish Relationship Validation

For upload:

- `accountId` must exist.
- The account platform must equal `platformId`.
- The account must be logged in.
- The video path must be authorized.

For submit:

- `recordId` must exist.
- The record platform must equal `platformId`.
- The record account must exist and belong to the same platform.
- The record must be in an allowed pre-submit state.
- Any cover path must be authorized.

Rejected requests must not change record state or issue network calls.

## Scheduled Publishing Idempotency

The current whole-flow retry wraps record creation, upload, and submit. This can duplicate publication when the platform accepted a request but the response was lost.

The replacement flow uses persisted stages:

1. Create one record for the task/platform execution.
2. Retry only upload operations that are safe or resumable.
3. Persist upload identifiers and metadata immediately.
4. Enter `submitting` before calling the final publish endpoint.
5. Never automatically call the final publish endpoint again after an ambiguous submission result.
6. If submission fails after the request may have reached the platform, mark the publish record `unconfirmed`. Mark the scheduled task `error` when no platform succeeded or `partial` when another platform succeeded, with a precise message requiring reconciliation.

Migration 008 will add nullable `source_task_id` to `publish_records` and a unique index on `(source_task_id, platform)` for scheduled records. The scheduled task repository will update `retry_count` for actual upload retry attempts. Restart recovery will inspect the existing task/platform record:

- `pending`, `uploading`, or `error` before submission: resume/retry upload using the same record.
- `uploaded`: continue to submission once.
- `submitting`: mark `unconfirmed`; never automatically submit again.
- `done` or `unconfirmed`: do not issue another publish request.

Platform-local retries may remain only for upload chunks, upload initialization known to be non-publishing, and read-only verification requests. Final content-submit calls must not be generically retried without a platform-supported idempotency key.

## Account Cleanup

Automatic deletion of duplicate platform accounts will be removed. Existing accounts will be preserved. The current UI may continue selecting the first logged-in account until explicit multi-account selection is designed, but startup must not destroy account records or sessions.

## Tests

Tests will be added before implementation and observed failing for the expected reason.

Required regression coverage:

- Trusted and untrusted IPC sender URLs.
- Navigation and external-window URL policy.
- Canonical authorized-path checks, including sibling-prefix and symlink cases where supported.
- Data URL MIME and decoded-size limits.
- IPC listener unsubscribe removes the registered wrapper.
- Account/platform and record/platform mismatch rejection.
- Kuaishou upload endpoint rejects HTTP and foreign/unexpected URL forms.
- HTTPS clients do not disable certificate validation.
- Scheduled submission is attempted at most once after entering the submit stage.
- Upload retry does not create multiple publish records.
- Retry counters are persisted.
- Startup registration does not delete same-platform accounts.

Existing tests, production build, and targeted lint checks for changed files must pass. The full lint result will still be reported because the repository already contains unrelated lint debt.

## Error Handling and Logging

- Security-policy failures return concise user-facing errors and structured logs without cookies, access tokens, authorization headers, upload tokens, or full submit payloads.
- Existing logs that expose upload-token prefixes, full request bodies, or platform fields containing tokens will be redacted.
- Ambiguous platform submission responses are never reported as confirmed success.

## Acceptance Criteria

- No remote upload or API path uses plaintext HTTP.
- No HTTPS request disables certificate validation.
- Main renderer privileged IPC is inaccessible from untrusted frames or navigated pages.
- Renderer file APIs cannot read arbitrary files from the home directory.
- Final scheduled publish submission is not automatically repeated.
- Invalid account/platform/record relationships are rejected before side effects.
- Event listeners unsubscribe correctly.
- Oversized or unsupported data URLs are rejected.
- Same-platform account records are preserved at startup.
- The API/HTTP-only publishing guardrail remains satisfied.
