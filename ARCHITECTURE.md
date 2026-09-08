# ARCHITECTURE — SIH Copilot

## Core design decision: no backend server

- **Per-user data** (status, notes, skill matrix) lives entirely in `chrome.storage.local` (or `chrome.storage.sync` for cross-device persistence). It never leaves the browser — no accounts, no privacy policy burden beyond a one-line disclosure, no hosting cost.
- **Shared historical data** (the corpus used for similarity detection) is identical for every user, so it doesn't need a live API. It's precomputed offline and shipped as a static JSON file — hosted (e.g., GitHub Pages) rather than bundled into the extension, so it can be refreshed yearly without a Chrome Web Store resubmission.
- **Similarity computation** runs entirely client-side: the extension loads the static embeddings and computes cosine similarity in the browser. No runtime network calls except fetching the static file (with a local cache/version check to avoid refetching on every page load).

## Data flow

```
                    SIH PORTAL PAGE
                          │
                          ▼
              ┌───────────────────────┐
              │   Content Script       │
              │  reads #dataTablePS    │
              │  (PS ID, title, org,   │
              │   category, theme)     │
              └───────────┬───────────┘
                          │
        ┌─────────────────┼──────────────────┐
        ▼                                     ▼
  chrome.storage.local              Static hosted JSON
  (status, notes, skills)           (past-years' PS + embeddings,
        │                            fetched + cached locally)
        │                                     │
        └──────────────┬──────────────────────┘
                       ▼
              Popup / injected UI
        (filters, status badges, similarity flag, fit score)
```

## Data extraction

The SIH portal does not expose PS data through a separate API — it is embedded directly in the page HTML, inside a table with id `#dataTablePS`. The content script extracts PS ID, title, organization, category, and theme from this table.

Requirements for resilience:
- Match columns by header text or stable attributes, not hardcoded cell indices.
- Run a sanity check after extraction (minimum expected row count / non-empty titles); log a clear warning on failure rather than failing silently.
- If the table renders asynchronously (post page-load JS or pagination), use a `MutationObserver` or a bounded retry instead of assuming the table exists at `document_idle`.

## Historical dataset lifecycle

1. After each SIH cycle concludes, download and parse that year's PS list (typically PDF).
2. Generate embeddings offline for each PS title/description using a small sentence-embedding model.
3. Merge into the existing static JSON dataset.
4. Publish the updated file to its hosted location (no extension code change required).
5. The extension detects a new dataset version on next fetch and updates its local cache.

## Extension structure

- **Manifest V3**, with a service-worker background script (no persistent background page).
- **`host_permissions`** scoped only to the SIH portal's domain — never `<all_urls>`.
- **Content script** — DOM extraction + UI injection (status badges, filter panel, notes panel).
- **Popup/options page** — skill matrix entry, settings.

## Explicitly not part of this architecture
- No server-side compute or storage.
- No user authentication.
- No cross-user data sharing (team voting) — see `PRD.md` / `DECISIONS.md`.
