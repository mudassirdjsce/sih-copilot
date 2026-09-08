# SIH Copilot

A Chrome extension that overlays the official Smart India Hackathon (SIH) problem-statement portal with a personal review workspace — status tracking, filters, notes, historical-repeat detection, and team-fit scoring — so you can evaluate hundreds of problem statements without losing track of what you've already reviewed.

## Why
The SIH portal lists problem statements with no workflow beyond plain browsing: no way to mark what you've read, no way to tell if a problem has appeared in a past year under a different name, no persistent notes. SIH Copilot adds that layer directly on top of the existing portal — no separate site to visit.

## Features
- **Status tagging** — ⚪ Unread / 🟡 Revisit / 🟢 Selected / 🔴 Rejected, saved automatically
- **Filtering** — by status, domain, organization type, and year
- **Notes** — per-problem-statement notes that persist across sessions
- **Historical detection** — flags when a PS is semantically similar to one from a past SIH cycle
- **Team-fit scoring** — score each PS against your own skill matrix

See `PRD.md` for full scope, including what was deliberately left out and why.

## How it works
No backend, no accounts. Your status/notes/skill matrix stay entirely in your browser's local storage. A small, shared dataset of past years' problem statements (refreshed yearly) is fetched from a static hosted file to power historical detection — see `ARCHITECTURE.md` for the full design.

## Installation

**For development / personal use:**
1. Clone this repository.
2. Go to `chrome://extensions` in Chrome.
3. Enable Developer Mode.
4. Click "Load unpacked" and select the project folder.

**From the Chrome Web Store:**
Once published — link to be added here.

## Privacy Policy
The SIH Copilot privacy policy is available here:
[Privacy Policy](https://mudassirdjsce.github.io/sih-copilot/privacy-policy.html)

## Project documentation
- `PRD.md` — problem, goals, scope
- `ARCHITECTURE.md` — system design
- `DATA_MODEL.md` — data schemas
- `IMPLEMENTATION_PLAN.md` — phased build plan
- `DECISIONS.md` — settled design decisions and their reasoning
- `TEST_PLAN.md` — verification checklist
- `AGENTS.md` — instructions for AI coding agents working in this repo

## Status
In development — see `IMPLEMENTATION_PLAN.md` for current phase.
