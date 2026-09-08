# DECISIONS — SIH Copilot

Settled calls and their reasoning. Do not silently reverse these — if a task seems to require it, raise it explicitly first.

## No backend server
**Decision:** All per-user data lives in `chrome.storage.local`/`.sync`. The historical dataset is a static file, not a live API.
**Why:** Once team voting and previous-solutions discovery were cut, nothing left actually requires server-side compute or shared mutable state. A backend would add hosting cost, auth complexity, and privacy surface for no corresponding feature need.

## Cut: previous-solutions discovery
**Decision:** Do not auto-discover past teams' GitHub repos, demos, or presentations for a given PS.
**Why:** No reliable link exists between a PS and past submissions — teams don't consistently tag their PS number, naming is inconsistent. Would produce noisy, misleading results rather than a trustworthy feature.

## Cut: novelty / competition scoring
**Decision:** Do not display invented metrics like "Novelty: 67/100" or "Competition: Medium."
**Why:** No real signal source exists for either. A displayed number implies precision that doesn't exist and could mislead a team's actual decision-making.

## Cut: team voting / multi-user sync
**Decision:** No accounts, no shared/synced team state.
**Why:** Requires a backend and auth for a feature that isn't essential to the core individual-review value proposition. Revisit only if the tool proves valuable enough to justify the added infrastructure later.

## Data extraction: DOM, not API
**Decision:** Extract PS data from the `#dataTablePS` table in the portal's HTML.
**Why:** Confirmed by direct inspection — the SIH portal does not load PS data through a separate discoverable API; it's embedded directly in the page.
**Consequence:** Extraction is more fragile to portal markup changes than an API call would be — mitigated by header-based matching and a sanity-check/warning system (see `ARCHITECTURE.md`).

## Historical dataset: hosted static file, not bundled
**Decision:** The yearly-refreshed historical JSON is fetched from a hosted static location, not bundled into the extension package.
**Why:** The dataset needs a yearly update after each SIH cycle. Bundling it would require a full extension version bump and Chrome Web Store re-review every year just for a data-only change. Hosting it separately decouples data updates from code releases.

## Manifest V3, permissions scoped to the SIH domain
**Decision:** Build on Manifest V3; request `host_permissions` only for the SIH portal's domain, never `<all_urls>`.
**Why:** Manifest V2 is no longer accepted for new Web Store submissions. Narrow permissions are more trustworthy to reviewers and users, and speed up store review.

## Historical data source: named Kaggle datasets, not raw PDF parsing
**Decision:** Use specific, named Kaggle datasets per year as the base for the historical dataset, rather than building a PDF scraper/parser from scratch:
- **2025 and 2026:** `theprtsh/sih-2025-problem-dataset` (select `sih-2026-ps.csv` for 2026, use the 2025 file from the same dataset for 2025) — schema-enforced, includes title, description, organization, category.
- **2024:** `adharshinikumar/sih-2024-ps-with-winning-teams-and-solutions` — includes title, description, category, and technology domain, plus extra winning-team/institute columns that are not needed and must be filtered out during ingestion (see `IMPLEMENTATION_PLAN.md`).
- **2023:** no adequate structured dataset with descriptions found. Out of scope for MVP — only reposted PDFs exist, which would need manual/OCR extraction. Revisit later as an optional addition, not a blocker.

**Why:** The work of collecting and cleaning past PS listings has already been done for these years. Building a custom PDF parser would duplicate that effort for no benefit. Each dataset should be spot-checked against an official-adjacent source before being trusted — they are third-party curated, not the official portal.

## Historical CSVs are downloaded once, not fetched/rebuilt by the agent repeatedly
**Decision:** Download the three CSVs (2025, 2026, 2024) once and commit them into a `/data/raw/` folder in the repo. The agent works from these local files for all Phase 2 parsing/embedding work.
**Why:** Having the agent re-discover, re-fetch, or re-derive this data on each session wastes tokens and risks it pulling a different or lower-quality source each time. A local, fixed copy is cheaper and deterministic. The agent should never be asked to "go find the historical data" — it should be told to read the specific files already in `/data/raw/`.

## Embeddings generated from title + description, not title alone
**Decision:** Historical PS embeddings are generated from title and description concatenated together.
**Why:** Titles are often short and generic; the description usually carries the actual distinguishing signal. Title-only embeddings would miss cases where the same underlying problem is reworded across years. This is a one-time offline computation, so the extra text length has no runtime cost.

## Public release intent
**Decision:** This is a personal project intended for public release via the Chrome Web Store, not restricted to internal team use.
**Why:** Stated goal is for any SIH participant to be able to use it, not just the author's own team.

## Team Fit scoring: pure semantic embeddings, zero theme/category metadata weight

**Decision:** Team Fit uses only semantic cosine similarity between a PS's precomputed 384-dim embedding and 7 domain prototype embeddings. SIH Theme and Category metadata contribute 0% to the numeric score (but are displayed in the tooltip for transparency).

**Why:** Direct inspection of all 226 SIH 2026 PS records revealed that theme labels are severely misassigned in the source dataset:
- PS 26003 ("AI-Based Cognitive Gaming and Memory Assistance Platform for Elderly Dementia Patients") → Theme: "Space Technology"
- PS 26018 ("Intelligent Land Record Digitization and Validation System") → Theme: "MedTech / BioTech / HealthTech"
- PS 26020 ("Design and Development of Innovative Hand-Spinning Equipment for Khadi") → Theme: "Blockchain & Cybersecurity"
- PS 26019 ("National Digital Platform for Land Governance") → Theme: "Blockchain & Cybersecurity"

Incorporating even a 30% metadata weight would systematically corrupt the scores for a large fraction of PSs. There is no safe threshold — the mismatch is not marginal noise but wholesale wrong categorization. The embedding of (title + description) already captures the actual technical content with high fidelity, as confirmed by spot-checks: GIS PS 26013 scored GIS=0.633 (all others ≤0.18); blockchain PS 26182 scored Blockchain=0.643; hardware drone PS 26177 scored Hardware=0.449.

**Formula:**
```
softmax_rel[d] = exp(rawCosineSim[d] / 0.08) / Σ exp(rawCosineSim[d'] / 0.08)
TeamFit        = Σ_d ( softmax_rel[d] × skill[d] / 10 ) × 100   (0–100)
```
Temperature T=0.08 chosen so the top domain receives ~85–95% of the softmax weight for strongly-typed PSs, giving a full-skill team ~85–95 fit. A pure-Web PS scores ~5 for an AI/ML-only team.

**Pipeline:**
- OFFLINE: `scripts/generate-domain-relevance.js` reads existing PS embeddings from `historical_embeddings.json`, embeds 7 domain prototypes once with Xenova/all-MiniLM-L6-v2, computes cosine similarities, writes `data/domain_relevance_2026.json` (~58 KB).
- RUNTIME: content.js fetches the static JSON (≤100ms), builds a `Map<psId, domainRel>`, and computes Team Fit as a dot product — zero model inference.

**Consequence:** Domain relevance data must be regenerated (one command, ~30s) whenever domain prototype texts change or a new SIH year's PSs are added. This is a data-only operation and does not require a code change or extension version bump.


## PS ID normalization: portal prefix SIH vs. bare numeric datasets
**Decision:** Apply 
ormalizePSId(raw) = String(raw).replace(/^SIH/i, "").trim() at every domain-relevance Map lookup site. Static JSON datasets keep their original bare-numeric IDs ("26001"). Phase 1 storage keys remain as the raw portal value ("SIH26001") � no migration.
**Why:** The live SIH 2026 portal renders PS codes with a "SIH" prefix in column 4 (e.g. "SIH26001"), while our offline-generated datasets (historical_embeddings.json, domain_relevance_2026.json) use the bare numeric form from the CSV ("26001"). Normalizing only at lookup time (never in storage, never in the JSON) is the smallest change that fixes the mismatch with zero downstream breakage.

## Major-domain tag: informational only, never in scoring
**Decision:** Each 2026 PS may carry a single high-level domainTag (ML � Web � App � Blockchain � Hardware � GIS � IoT � Cybersecurity � Data � Biotech). It is stored in domain_relevance_2026.json, displayed as a muted pill in the UI, and has zero effect on Team Fit scores, filtering, or sorting.
**Why:** The embedding-based Team Fit is the authoritative technical classification and must not be contaminated by a simpler keyword heuristic. The tag is purely for rapid human browsing. 106/226 PSs are intentionally left untagged rather than forcing an uncertain classification.
