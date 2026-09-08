# PRD — SIH Copilot

## Problem

The official Smart India Hackathon (SIH) problem-statement portal lists hundreds of problem statements (PS) from ministries, government bodies, PSUs, and NGOs, but offers no workflow beyond basic browsing. For a student evaluating problems to find the right fit, this creates real friction:

- No way to mark a PS as read, shortlisted, or rejected — everything has to be tracked manually.
- No way to filter beyond the portal's basic categories.
- No way to tell whether a PS is a genuinely new challenge or a rehash of one from a previous SIH cycle under a different title.
- No persistent notes tied to a specific PS, so reasoning behind a decision is easily forgotten across a review session spanning hundreds of statements.

This is a workflow and evaluation-tooling problem, not a data problem — the portal already has the data.

## Target user
A student (initially the author) reviewing SIH problem statements to select one to work on, either solo or as part of a team. Built as a personal project, released publicly so any SIH participant can use it.

## Goals
- Let a user track their own read/shortlist/reject status per PS, persistently, across sessions.
- Let a user filter the PS list by status, domain, organization type, and year.
- Let a user attach notes to a PS.
- Flag when a PS is semantically similar to one from a past SIH year.
- Score a PS against a user-defined skill matrix.
- Ship as a public, installable Chrome extension with no ongoing hosting cost or backend maintenance.

## In-scope features

| Feature | Description |
|---|---|
| Status tagging | ⚪ Unread / 🟡 Revisit / 🟢 Selected / 🔴 Rejected per PS, saved automatically |
| Filtering | Combine status, year, domain, organization type |
| Notes | Free-text notes per PS |
| Historical detection | Similarity score + matching year(s) against past SIH cycles |
| Team-fit scoring | PS scored against a user-entered skill matrix |

## Explicitly out of scope

Cut after review — see `DECISIONS.md` for the full reasoning:

- **Previous-solutions discovery** — no reliable link exists between a PS and past teams' GitHub/YouTube work; results would be noisy and misleading rather than useful.
- **Novelty / competition scoring** — no real signal exists for either; a displayed number would be fabricated confidence, not a fact.
- **Team voting / multi-user sync** — requires accounts and a live backend for a feature that isn't essential to the core value proposition.

## Success criteria
- The author can use it to review the full current-year PS list faster than manual tracking, and actually does so.
- Historical-detection flags are accurate enough to be trustworthy (no false confidence).
- Publicly installable via the Chrome Web Store with no user data leaving the device except the shared, non-personal historical dataset fetch.

## Constraints
- No backend server (cost and maintenance reasons — see `ARCHITECTURE.md`).
- SIH portal's terms of use for automated access must be checked before shipping the DOM-extraction content script.
- Historical dataset must be refreshed once per year after each SIH cycle concludes.
