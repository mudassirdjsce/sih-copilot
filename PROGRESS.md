# SIH Copilot — Progress Log

> **Rule:** This file is only edited when the user explicitly asks.
> It is a "come back after a break" reference — what is done, how it is done, what is next.

---

## Quick state summary

| Item | Status |
|---|---|
| Project documentation | Done |
| Historical CSV data | Done (analyzed + moved to /data/raw/) |
| Phase 1 -- Extension skeleton | Done (with bug fixes) |
| Phase 2 -- Embedding runtime (PoC) | **Done ✅** (offscreen doc + Transformers.js) |
| Phase 2 -- Historical dataset pipeline | **Done ✅** (607 embeddings in data/historical_embeddings.json) |
| Phase 2 -- Similarity UI in extension | **Done ✅** (content.js v0.4.0 with similarity badges) |
| Phase 2 -- Serve JSON + push to GitHub | ⚠️ **Pending** — push repo + update HISTORICAL_DATA_URL |
| Phase 3 -- Team-fit scoring | Not started |
| Phase 4 -- Polish + Web Store | Not started |


---

## What has been built

### 1. Project documentation (all in repo root)

| File | Purpose |
|---|---|
| PRD.md | Problem, goals, out-of-scope list |
| ARCHITECTURE.md | System design, data flow, storage strategy |
| DATA_MODEL.md | Exact schemas for stored records + historical dataset |
| DECISIONS.md | Settled design calls with reasoning |
| IMPLEMENTATION_PLAN.md | Phased plan, current + future steps |
| AGENTS.md | Rules the AI agent must follow at all times |
| PROGRESS.md | This file |

All written before any code was touched. The agent reads these before making changes.

---

### 2. Historical CSV data

**Files (in /data/raw/):**

| File | Year | Rows | Unique PSes |
|---|---|---|---|
| SIH_PS_Winners_2024.csv | 2024 | 324 | 247 (77 duplicates -- same PS won in multiple categories) |
| sih-2025-ps.csv | 2025 | 135 | 135 |
| sih-2026-ps.csv | 2026 | 226 | 226 |

**Column mapping confirmed by actual inspection:**

| DATA_MODEL field | 2024 column | 2025 column | 2026 column |
|---|---|---|---|
| psId | PS Number | PS Number | PS Number |
| title | Problem Statement Title | Problem Statement Title | Problem Statement Title |
| organization | Organization Name | Organization Name | Organization |
| category | Category | Category | Category |
| theme | Theme | Theme | Theme |
| year | (add manually: 2024) | (add manually: 2025) | (add manually: 2026) |

**Important notes:**
- 2024 has 77 duplicate rows -- same PS won in multiple sub-categories. Dedup on PS Number before embedding.
- Embeddings should be computed on title + description concatenated, not title alone.
- CSVs were originally in the repo root and moved to /data/raw/ early in session 1.

---

### 3. Phase 1 -- Chrome Extension (complete)

#### File structure built

```
extension/
  manifest.json          <- Manifest V3, host_permissions scoped to sih.gov.in only
  background/
    service-worker.js    <- Minimal MV3 service worker (keeps extension alive)
  content/
    content.js           <- Main logic: extraction + badge injection (v0.3.0)
    content.css          <- Injected styles, all prefixed sih- to avoid portal collisions
  popup/
    popup.html           <- Extension popup (stats overview)
    popup.css            <- Popup styles
    popup.js             <- Popup script (reads chrome.storage.local)
  icons/
    icon16.png
    icon48.png
    icon128.png
```

#### What the extension does (Phase 1 feature set)

1. **Status badges** -- Each PS row gets a clickable Unread badge. Click to cycle:
   Unread > Revisit > Selected > Rejected. Status persists in chrome.storage.local keyed by PS ID.
2. **Notes panel** -- A Notes toggle button per row reveals a textarea. Notes auto-save
   600 ms after typing stops. Also persisted in storage.
3. **Filter sidebar** -- Fixed left sidebar with Search, Status, Category, Theme filters.
   Filters apply to currently visible rows.
   Shows "X shown / Y tagged / Z known PS" counter.
4. **DataTables lifecycle** -- Handles pagination, page-length changes, search, and sort
   without user intervention. All rendered rows get tagged regardless of which page the user is on.

---

### 4. Debugging journey (critical context for future sessions)

The SIH 2026 portal (sih.gov.in/sih2026PS) uses jQuery DataTables on #dataTablePS.
Three significant bugs were found and fixed.

---

#### Bug 1 -- Manifest JSON encoding error

Symptom: "Could not load manifest" / "invalid unicode code point at line 5"
Cause: The em-dash character (--) in the description was written as a raw multi-byte
       character that broke JSON parsing in Chrome.
Fix: Replaced with a plain ASCII hyphen in manifest.json.

---

#### Bug 2 -- Column detection failed (PS ID / Title not found)

Symptom:
  [SIH Copilot] Could not identify required columns (PS ID / Title) in #dataTablePS. [object Object]

Root cause: The original extractor looked for a <thead> in #dataTablePS to find column headers.
The SIH 2026 portal HTML has NO <thead> in the outer table -- headers were in a commented-out
<tfoot>. So table.querySelector("thead tr") returned null and extraction aborted immediately.

Also: table.querySelector("thead") returned a false positive -- it found the <thead> inside one
of the nested modal tables (each PS modal has a <table id="settings"><thead>...), not the outer
table header. So hasThead:true in the log was misleading.

Fix (v0.2.0): Replaced thead-based detection with fixed column index extraction confirmed
from the actual page source:

  [0] S.No.    [1] Org    [2] Title <a> + modal    [3] Category
  [4] PS ID    [5] Count  [6] Theme                [7] Date

Title is extracted from the FIRST TEXT NODE of <a data-toggle="modal"> inside cell[2]
(not anchor.textContent, which would include the entire modal body text).
Description is extracted from the labeled <table id="settings"> inside the modal.

---

#### Bug 3 -- Only 10 of 226 rows tagged (DataTables pagination)

Symptom: Extension injected badges on 10 rows. Changing DataTables page length from 10 to 100
showed 100 rows but only the original 10 had badges. Screenshot confirmed rows 8-10 tagged,
row 11 onward bare.

Root cause: DataTables 1.10.x physically detaches off-page row nodes from the tbody DOM.
init() ran once at load, found only the 10 currently rendered rows, injected, stopped.
No code listened for subsequent DataTables redraws.

Fix (v0.3.0 -- current): Three-layer lifecycle:

  1. Immediate -- processVisibleRows() called at init() time handles the initial 10 visible rows.

  2. Primary -- injectDTListener() injects a <script> into the page's JS execution context
     (the only way to access window.jQuery from a content script -- content scripts run in an
     isolated world). That script subscribes to 'draw.dt' on #dataTablePS and postMessages
     back to the content script on every draw. Content script calls processVisibleRows()
     on each message.

     draw.dt fires for: pagination, page-length change, search, sort -- everything.

  3. Fallback -- MutationObserver on <tbody> with childList:true, subtree:false.
     Catches any draws the jQuery event misses.

     subtree:false is critical: our own badge injections add <div>/<span> inside <td>
     (grandchildren+ of tbody). Those are invisible to the observer. NO INFINITE LOOP possible.

Idempotency: Each <tr> gets data-sih-injected="true" set synchronously (BEFORE any await)
on first injection. This attribute lives on the DOM node. DataTables keeps the node alive
even when detached. When DT re-attaches the node on returning to a page, processVisibleRows()
sees the marker and skips it. Zero double-badges possible.

---

#### Key confirmed facts about the SIH 2026 portal

- DataTables init: $('#dataTablePS').DataTable({"bInfo": false})
  Client-side processing, default pageLength: 10.
- No <thead> in raw HTML outer table.
- All row nodes kept in DataTables internal registry; only current page nodes are in the DOM.
- draw.dt fires after every pagination, page-length, search, and sort.
- api.page.info() returns: { page, length, recordsDisplay, recordsTotal }.
- Page-world <script> injection is needed to access window.jQuery from a content script.

---

## Current content.js version

Version: v0.3.0
Extractor tag: SIH2026-DATATABLES-LIFECYCLE
File: extension/content/content.js (562 lines)

Expected console after a clean page reload:

  [SIH Copilot] Extractor version: SIH2026-DATATABLES-LIFECYCLE
  [SIH Copilot] Table found: #dataTablePS
  [SIH Copilot] Initial draw: { page: "page 1", visibleRows: 10, newlyTagged: 10, alreadyTagged: 0, totalKnownPS: 10 }
  [SIH Copilot] DataTables listener registered. Total records: <N>
  [SIH Copilot] DataTables draw: { initial: true, page: "page 1", pageLength: 10, newlyTagged: 0, alreadyTagged: 10 }

After changing to 100 entries:

  [SIH Copilot] DataTables draw: { page: "page 1", pageLength: 100, visibleRows: 100, newlyTagged: 90, alreadyTagged: 10, totalKnownPS: 100 }

After next page:

  [SIH Copilot] DataTables draw: { page: "page 2", pageLength: 100, visibleRows: <N>, newlyTagged: <N>, alreadyTagged: 0 }

After returning to page 1 (no duplicates):

  [SIH Copilot] DataTables draw: { page: "page 1", pageLength: 100, visibleRows: 100, newlyTagged: 0, alreadyTagged: 100 }

---

## What is NOT done yet (next steps)

### Phase 2 -- Historical repeat detection
- Step 9: Source / structure historical dataset from the three CSVs.
- Step 10: Write a Node.js ingestion script to normalize + dedup rows.
- Step 11: Compute embeddings offline (title + description).
- Step 12: Export as static JSON; host on GitHub Pages.
- Step 13: Add fetch-and-cache layer in the extension.
- Step 14: Compute cosine similarity client-side.
- Step 15: Display "appeared N times" + similarity badges.

### Phase 3 -- Team-fit scoring
- Step 16: Settings screen for skill matrix input.
- Step 17: Deterministic scoring function (weighted theme/category match).
- Step 18: Display inline score.

### Phase 4 -- Polish + Web Store
- Steps 19-23: Testing, privacy statement, Chrome Web Store submission.

---

## How to load the extension for testing

1. Open chrome://extensions
2. Enable Developer mode (top-right toggle)
3. Click Load unpacked
4. Select: c:\Chrome extension\extension\
5. Navigate to https://www.sih.gov.in/sih2026PS
6. Open DevTools > Console > filter by [SIH Copilot]

To reload after code changes:
  Click the refresh button on the extension card in chrome://extensions
  then hard-reload the SIH tab (Ctrl+Shift+R).

---

Last updated: 2026-09-07 (session 2)

---

## Phase 2 — Embedding runtime (DONE ✅)

### Proven result (smoke test output)

```
✅ PASS
Model:             Xenova/all-MiniLM-L6-v2
ORT version:       1.26.0-dev.20260416-b7804b056c
Embedding dim:     384
Inference:         1942 ms (first run; cached runs are ~200 ms)
Cosine similarity: 0.920693   (two railway-AI sentences)
First 5 values:    [-0.046946, -0.037217, -0.037385, 0.083746, 0.047655]
```

---

### Architecture chosen: MV3 Offscreen Document

```
popup.js
    │  chrome.runtime.sendMessage({type:"SMOKE_TEST"})
    ▼
background/service-worker.js  (1.6 KB -- no ONNX code)
    │  ensureOffscreen()  →  chrome.offscreen.createDocument(...)
    │  chrome.runtime.sendMessage({target:"offscreen", type:"SMOKE_TEST"})
    ▼
offscreen/offscreen.html  +  offscreen.js  (1184 KB)
    │  fetch(cdn.jsdelivr.net/ort-wasm-simd-threaded.asyncify.wasm)  [connect-src]
    │  env.backends.onnx.wasm.wasmPaths  = {}         ← blocks library auto-CDN-set
    │  env.backends.onnx.wasm.wasmBinary = asyncifyBuffer
    │  pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")
    │  embed(text) → Float32Array[384]
    └─ sendResponse({ok:true, dim:384, similarity:0.92, ...})
```

**Why offscreen:** MV3 Service Workers forbid dynamic `import()` (HTML spec) and cannot
run ONNX WASM. An offscreen document is a normal DOM window — dynamic import and
WebAssembly.instantiate both work.

---

### Build pipeline

```
node scripts/build.js
  → extension/background/service-worker.js   (~1.6 KB)   lightweight router only
  → extension/offscreen/offscreen.js         (~1184 KB)  Transformers.js + ONNX factory
```

Source files:
- `extension/background/service-worker-src.js`  -- edited directly
- `extension/offscreen/offscreen-src.js`        -- edited directly
- `scripts/build.js`                            -- esbuild config, run with `node scripts/build.js`

---

### Debugging journey: three CSP/WASM failures resolved

#### Failure 1 -- `chrome.offscreen` is undefined

Symptom: `TypeError: Cannot read properties of undefined (reading 'createDocument')`

Root causes (three simultaneous bugs):
1. `"offscreen"` permission was missing from manifest.json
2. `OFFSCREEN_DOCUMENT_PATH` had a leading `/` (`"/offscreen/offscreen.html"`)
   → chrome.runtime.getURL() needs a relative path; leading / produces wrong URL
3. `us.aws.cdn.hf.co` was missing from CSP connect-src (from a previous edit being lost)

Fixes: added `"offscreen"` to permissions; removed leading slash; restored CDN host.

---

#### Failure 2 -- `.asyncify.mjs` blocked by `script-src`

Symptom:
```
Loading the script 'cdn.jsdelivr.net/.../ort-wasm-simd-threaded.asyncify.mjs'
violates Content Security Policy: "script-src 'self' 'wasm-unsafe-eval'"
```

Root cause: `@huggingface/transformers@4.2.0` auto-sets `ONNX_ENV.wasm.wasmPaths`
to CDN URLs for any non-ServiceWorker context where `wasmPaths` is falsy:

```javascript
// Inside the library (runs before pipeline()):
if (!(self instanceof ServiceWorkerGlobalScope) &&
    ONNX_ENV.versions?.web &&
    !ONNX_ENV.wasm.wasmPaths) {          // ← true if we leave wasmPaths unset
  ONNX_ENV.wasm.wasmPaths = {
    mjs:  "cdn.../ort-wasm-simd-threaded.asyncify.mjs",   // triggers import()
    wasm: "cdn.../ort-wasm-simd-threaded.asyncify.wasm",
  };
}
```

`import()` of an external CDN URL is blocked by MV3's `script-src 'self'`
(external origins cannot be added to script-src in MV3 extension pages — hard browser limit).

Fix: Set `env.backends.onnx.wasm.wasmPaths = {}` before calling `pipeline()`.
`!{}` is `false` → library skips its auto-set. With no `.mjs` key, the ONNX
`fs()` function uses the bundled Emscripten factory (`os`) instead of `import()`.

---

#### Failure 3 -- wrong WASM binary variant

Symptom: Would have failed with WebAssembly format mismatch.

Root cause: The bundled Emscripten factory in `offscreen.js` is the **asyncify** variant
(visible from `bt()` hardcoding `"ort-wasm-simd-threaded.asyncify.wasm"`).
We were fetching the non-asyncify binary (`ort-wasm-simd-threaded.wasm`, 12.6 MB).

Fix: Fetch `ort-wasm-simd-threaded.asyncify.wasm` (22.5 MB) instead.
Cache name bumped to `sih-copilot-ort-wasm-v2` to evict any cached wrong binary.

---

### Manifest state after Phase 2

```json
"permissions": ["storage", "tabs", "offscreen"],
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';
    connect-src 'self' https://huggingface.co https://cdn-lfs.huggingface.co
    https://cdn-lfs-us-1.huggingface.co https://us.aws.cdn.hf.co https://cdn.jsdelivr.net;"
}
```

---

## What is next (Phase 2 continued)

### Step A -- Historical dataset pipeline (Node.js, offline, run once)

1. Read `/data/raw/SIH_PS_Winners_2024.csv`, `sih-2025-ps.csv`, `sih-2026-ps.csv`
2. Normalize columns to `{psId, title, organization, category, theme, year}`
3. Dedup 2024 data on `psId` (77 duplicate rows from multi-category winners)
4. Compute embeddings for each row: embed(`title + " " + organization`)
5. Output: `/data/historical_embeddings.json`
   Schema: `[{psId, title, year, embedding: number[384]}]`

### Step B -- Serve the JSON (no server allowed)
- Commit to repo; serve via GitHub Pages raw URL or bundle directly into extension

### Step C -- Similarity computation in extension
- content.js: for each displayed PS, fetch/cache `historical_embeddings.json`,
  compute cosine similarity vs each historical embedding
- Display: "Similar to SIH 2024 PS-1234 (87% match)" badge on PS rows

### Step D -- "Appeared N times" count
- Count exact psId matches across years; display "Repeat (3×)" badge