# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2025-08-16

### Added
- Model selector dropdown in `src/routes/+page.svelte` allowing choice of `GPT-5`, `GPT-5-mini`, `GPT-5-nano`, and `GPT-4o`.
- Per-email "Triage" button on each email card to triage a single item with the selected Model and Tone.
- `TRIAGE_MODELS` and model override support in `generateEmailDraft()` within `src/lib/gpt.ts`.
- `generateEmailDraftMulti()` in `src/lib/gpt.ts` (not currently used by the UI) to support future multi-model comparisons.
- Loading spinner icon next to the "Thinking..." summary state in `src/routes/+page.svelte`.
- Google OAuth Step 2 implementation:
  - PKCE utilities in `src/lib/oauth/pkce.ts`.
  - Google OAuth helpers in `src/lib/oauth/google.ts` (build auth URL, exchange code for tokens).
  - In-memory session store in `src/lib/oauth/session.ts`.
  - `GET /auth/login` in `src/routes/auth/login/+server.ts` to initiate OAuth with state + PKCE.
  - `GET /auth/callback` in `src/routes/auth/callback/+server.ts` to verify state, exchange code, and set a session cookie.
  - `GET /api/gmail/profile` in `src/routes/api/gmail/profile/+server.ts` (fetch Gmail profile, auto-refresh token when needed).
  - `GET /auth/logout` in `src/routes/auth/logout/+server.ts` (clear session and cookie).
  - "Login with Google" link button on home page `src/routes/+page.svelte`.
  - `GET /api/gmail/messages` in `src/routes/api/gmail/messages/+server.ts` (list newest 25 messages with Subject/From/Date/snippet; auto-refresh token).
  - New Gmail modify proxy `POST /api/gmail/modify` in `src/routes/api/gmail/modify/+server.ts` to securely apply label changes.
  - Optional inbox grouping in `src/routes/+page.svelte` with a "Group by" selector:
    - Group by Subject (ignores common reply/forward prefixes)
    - Group by Thread (uses Gmail `threadId`)
    - Shows a count badge on grouped cards and chooses representative by highest triage score
  - Home page now shows signed-in email and lists latest Gmail messages; includes Logout button.
  - Unified list row headers for both grouped and single emails; a chevron toggles expansion everywhere, and singles display header snippets.
  - Visual engaged indicator for expanded groups (rotating chevron, highlight, and "Open" badge).
  - Spam action button next to Unsubscribe. Mark-for-deletion tracking and post-triage confirmation flow to delete marked messages.

### Changed
- Global "Triage My Inbox" button kept for batch processing; UI updated to work with the selected Model.
- PKCE base64url encoding in `src/lib/oauth/pkce.ts` now uses `Buffer.from(Uint8Array)` to avoid binary string conversion issues that could break `code_challenge` generation and lead to `invalid_grant`.
 - Moved final redirect in `src/routes/auth/callback/+server.ts` outside try/catch to avoid swallowing redirects as errors.
 - Removed mock inbox usage from `src/routes/+page.svelte`; UI now exclusively uses live Gmail data (`/api/gmail/messages`).
 - Decoded HTML entities and RFC 2047 headers in `src/routes/api/gmail/messages/+server.ts` so Subject/From/snippets/body render correctly (e.g., apostrophes, accented characters).
 - Added global Default Tone selector in `src/routes/+page.svelte`; triage now uses per-message override or falls back to the global default.
- Inbox view can be filtered by Category. Ungrouped view now sorts by Date (desc) so newest is first. Grouped view sorts by latest message in each group (desc);
  category badges are shown per email.
- Default grouping now starts as "Thread" unless a prior preference exists in localStorage.
- Grouped headers use a larger subject font size for better differentiation.

### Notes
- Ensure `VITE_OPENAI_KEY` is set; optionally configure default model via `VITE_OPENAI_MODEL`. Temperature can be set via `VITE_OPENAI_TEMPERATURE` (omitted for some `gpt-5-*` variants).
