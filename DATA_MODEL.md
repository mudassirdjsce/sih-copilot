# DATA_MODEL — SIH Copilot

## Per-PS user record (`chrome.storage.local`)

```json
{
  "psId": "1042",
  "status": "selected",
  "notes": "Good CV + GIS combination. Dataset seems available.",
  "lastViewed": "2026-09-05"
}
```

- `status`: one of `unread` (default) | `revisit` | `selected` | `rejected`
- `notes`: plain text, kept reasonably short if using `chrome.storage.sync` (per-item quota is small)
- `lastViewed`: ISO date, updated whenever the user opens/interacts with the PS

## Skill matrix (single record, per browser profile)

```json
{
  "AI/ML": 9,
  "Web": 10,
  "Mobile": 7,
  "GIS": 8,
  "Blockchain": 6,
  "IoT": 3,
  "Hardware": 2
}
```

Scale: 0–10 per domain, entered once via the options/popup UI, editable anytime.

## Static historical dataset (hosted JSON, refreshed yearly)

```json
{
  "psId": "2025-0873",
  "year": 2025,
  "title": "Smart Municipal Waste Management",
  "description": "Develop a solution for tracking and optimizing municipal waste collection routes using IoT sensors and real-time data...",
  "organization": "Ministry",
  "category": "Software",
  "theme": "IoT",
  "embedding": [0.0123, -0.0456, "..."]
}
```

- One entry per past-year PS.
- `embedding`: generated offline from **title + description concatenated**, not title alone — descriptions carry most of the actual similarity signal; title-only embeddings miss cases where the same underlying problem is worded differently. Title and description are stored as separate fields for display, but embedded together.
- Not regenerated at runtime — precomputed once per dataset refresh.
- File includes a top-level `version` or `lastUpdated` field so the extension can detect and cache new releases.
- Source: built by an offline ingestion script from local CSVs in `/data/raw/`. Exact column mappings confirmed by inspection:

| Target field | `SIH_PS_Winners_2024.csv` | `sih-2025-ps.csv` | `sih-2026-ps.csv` |
|---|---|---|---|
| `psId` | `ID` | `Problem_Statement_ID` | `Problem_Statement_ID` |
| `title` | `Title` | `Problem_Statement_Title` | `Problem_Statement_Title` |
| `description` | `Description` | `Description` | `Description` |
| `organization` | `Organisation` *(British spelling)* | `Organization` | `Organization` |
| `category` | `Category` | `Category` | `Category` |
| `theme` | `Technology_Bucket` *(column renamed during ingestion)* | `Theme` | `Theme` |
| `year` | *(absent — hardcode `2024`)* | `Year` | `Year` |

- **2024 deduplication required**: the file has 324 rows but only 247 unique PS IDs — each PS appears multiple times (once per winning team). The ingestion script must deduplicate by `ID` after dropping all team columns (`TEAM ID`, `IDEA ID`, `TEAM NAME`, `TEAM LEADER NAME`, `WINNING STATUS`, `INSTITUTE`, `INSTITUTE CITY`, `INSTITUTE STATE`, `NODAL CENTER`, `MINISTRY/GOVT DEPT/ORGANISATION`).
- **Drop from 2025/2026**: `Youtube_Links` and `Dataset_Links` — both are empty in the current files.
- 2023 is not included — no adequate structured source found. See `DECISIONS.md`.
- Total unique PSes after ingestion: ~608 (247 from 2024 + 135 from 2025 + 226 from 2026).

## Live PS record (extracted at runtime — not stored persistently)

Extracted from `#dataTablePS` on the current portal page:

```json
{
  "psId": "1042",
  "title": "AI-Based Watershed Monitoring",
  "organization": "Ministry",
  "category": "Software",
  "theme": "AI/ML"
}
```

## Computed / display-only fields (not stored, recomputed on view)

```json
{
  "similarPastPS": [
    {"year": 2025, "score": 0.87},
    {"year": 2024, "score": 0.79}
  ],
  "teamFitScore": 87
}
```

- `similarPastPS`: cosine similarity between the current PS's embedding and each historical entry; only scores above a defined threshold are shown.
- `teamFitScore`: derived from matching the live PS's `theme`/`category` against the user's skill matrix — a deterministic weighted match, not a model output.

## Field naming note
`organization`, `category`, and `theme` map directly to the columns available in the portal's `#dataTablePS` table (see `ARCHITECTURE.md`) — extraction and storage should use these same field names throughout to avoid translation bugs between layers.
