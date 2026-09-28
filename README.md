# Games R Us, by AI & I

A free hub of card and casino-style games. For entertainment only; no real money is ever involved.

## What's inside

| Path | What it is |
|---|---|
| `index.html` | The hub: every table in one place |
| `blackjack-reversal.html` | Blackjack Reversal |
| `blackjack-reversal-halfbank.html` | Half-Bank Mode |
| `bj-tournament/` | Table VII Tournament |
| `poker/` | Table VII Poker |
| `blind-poker/` | Blind Poker Fury |
| `roulette/` | Roulette Strategy Lab (in development) |
| `engine/` | Table Finder, the AI guide that recommends a table |
| `api/chat.js` | Serverless function behind the Table Finder |
| `data/gub.json` | The rulebook the Table Finder reasons over |
| `feedback.html` | Beta feedback form |
| `reversal-system-legal-review.html` | System design write-up for legal review |

Every game is a single self-contained HTML page with no build step.

## Turning on the Table Finder

The Table Finder calls Claude through `api/chat.js`, which keeps the API key on the server. In Vercel, open Project Settings, then Environment Variables, and add:

- `ANTHROPIC_API_KEY`: your key from the Anthropic Console (required)
- `ANTHROPIC_MODEL`: optional, defaults to `claude-sonnet-5`

Redeploy after adding them. Until the key is set, the Table Finder shows a "not switched on yet" message; every game works without it.

Never commit a real key. `.gitignore` already excludes `.env` files, and `.env.example` lists the variable names only.

## Updating the Table Finder's knowledge

Edit `data/gub.json` when a game's rules change. Each entry has an `id`, `title`, `url`, `summary`, `body`, `tags` and `details`. The Table Finder only recommends what's written there.
