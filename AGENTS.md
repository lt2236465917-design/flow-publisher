# Project Guardrails

## Publishing Mode Is API/HTTP Only

This project must implement platform publishing only through API/HTTP request flows.

Do not implement, suggest, or add fallbacks that simulate a user publishing inside a platform creator center. This prohibition applies to Xiaohongshu and every other platform.

Forbidden publishing approaches:

- Opening a creator-center publishing page and uploading media through a file input.
- Filling title, description, tags, cover, location, or declaration fields in the platform UI.
- Clicking publish, submit, confirm, or similar buttons in the platform UI.
- Using Playwright, Electron BrowserWindow, Chrome automation, DOM injection, `setInputFiles`, keyboard/mouse events, or file chooser automation to complete publishing.
- Treating UI automation as a fallback when API/HTTP publishing returns an error, ambiguous success, HTTP 461, missing `note_id`, or any other incomplete response.

Allowed browser usage:

- Login windows for user-authenticated session capture.
- Hidden/local signing contexts used only to produce request signatures or session-bound HTTP headers for API/HTTP requests.
- HTTP requests executed in an authenticated browser context only when the request itself is the API call and no UI fields are filled or publish buttons clicked.

When API/HTTP publishing fails, keep the logs and return a precise API/HTTP error. Continue debugging the API request sequence, headers, signing, payload, upload metadata, and response verification. Never switch to simulated creator-center publishing.

Future agents and new conversations must follow this rule even if a UI automation fallback seems easier or more reliable.
