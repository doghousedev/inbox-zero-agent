# Inbox Zero Agent

SvelteKit app that triages emails with OpenAI and drafts replies. Includes Tailwind CSS (v4) styling and per‑email tone selection.

## Features

- **AI triage**: summarize, score importance, and draft a reply for each email
- **Per‑email tone**: Professional, Friendly, Brief, Empathetic (dropdown on each card)
- **Tailwind v4** UI in dark mode
- **Sorted view**: emails ordered by highest importance score

## Prerequisites

- Node 18+ (or 20+ recommended)
- pnpm (preferred)

## Setup

1) Install dependencies

```sh
pnpm install
```

2) Configure environment

Create a `.env` file in the project root and add your OpenAI key:

```env
VITE_OPENAI_KEY=sk-...
```

> The app reads `import.meta.env.VITE_OPENAI_KEY` in `src/lib/gpt.ts`.

## Develop

Start the dev server:

```sh
pnpm dev
```

Then open http://localhost:5173/

## Usage

1) Click "Triage My Inbox" to generate summaries, scores, and drafts.
2) For any email card, change the **Tone** dropdown to regenerate the draft in that style.
   - The card shows a small "Regenerating…" status while processing.

## Build & Preview

```sh
pnpm build
pnpm preview
```

## Tech notes

- **SvelteKit** with `@sveltejs/adapter-auto`
- **Tailwind v4** via `@tailwindcss/vite` and `src/app.css` (`@import 'tailwindcss'`)
- **OpenAI API** via `fetch('https://api.openai.com/v1/chat/completions')`
- Core files:
  - `src/routes/+page.svelte` — UI and triage flow
  - `src/lib/gpt.ts` — prompt building and response parsing
  - `src/lib/mockEmails.ts` — sample data

## Troubleshooting

- Empty or missing drafts: ensure `VITE_OPENAI_KEY` is set and valid
- Network/CORS errors: check firewall/VPN and retry
- Styling not applied: confirm Tailwind plugin is active in `vite.config.ts` and `src/app.css` is imported in `+layout.svelte`

