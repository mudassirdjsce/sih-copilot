# AGENTS.md — SIH Copilot

## What this project is
A Chrome extension that overlays the official SIH problem-statement portal with a personal review workspace: status tagging, notes, filters, historical-repeat detection, and team-fit scoring. It is a personal project intended for public release on the Chrome Web Store.

## Read before working
Before making non-trivial changes, consult:
- `PRD.md` — the problem being solved and what's in/out of scope
- `ARCHITECTURE.md` — the system design and why it's shaped this way
- `DATA_MODEL.md` — exact schemas for stored and extracted data
- `DECISIONS.md` — settled calls and their reasoning; do not silently reverse these
- `IMPLEMENTATION_PLAN.md` — current phase and what's next

## Non-negotiable constraints

1. **No backend server.** Per-user data (status, notes, skill matrix) lives only in `chrome.storage.local` (or `.sync`). The historical dataset is a static JSON file, fetched or bundled — never a live API. Do not introduce a server, database, or user accounts.
2. **Data extraction is DOM-based, not API-based.** The SIH portal embeds PS data directly in HTML inside a table with id `#dataTablePS` — there is no separate data API. Extraction logic must read from this table.
3. **Manifest V3 only.** No Manifest V2 patterns (e.g., persistent background pages).
4. **`host_permissions` scoped to the SIH portal domain only.** Never request `<all_urls>` or broad host access.
5. **No fabricated confidence scores.** Any score shown to the user (team-fit, similarity) must be traceable to a real computation. Never display an invented metric like "novelty" or "competition level" with no underlying signal.

## Explicitly out of scope — do not implement without asking
These were considered and deliberately cut. Do not reintroduce them as a "helpful" addition to an adjacent feature:
- Previous-solutions discovery (auto-finding past teams' GitHub/YouTube work)
- Novelty / competition scoring
- Team voting or any multi-user sync feature

If a task seems to require one of these, stop and flag it rather than building it.

## Coding conventions
- Extraction logic should match on column headers / stable attributes where possible, not hardcoded cell indices — the portal's markup can change between years.
- Any DOM-reading code must include a sanity check (e.g., minimum non-empty row count) that logs a clear warning on failure rather than failing silently.
- If the target table may render asynchronously, use a `MutationObserver` or bounded retry rather than assuming `document_idle` is sufficient.
- Keep the historical dataset refresh a data-only operation — updating it should never require a code change or extension version bump (see `ARCHITECTURE.md`).
