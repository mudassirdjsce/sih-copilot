/* ============================================================
   SIH Copilot -- Content Script                      v0.4.0
   Extractor: SIH2026-DATATABLES-LIFECYCLE

   v0.4.0 adds Phase 2: Historical Repeat Detection
   - Fetches/caches historical_embeddings.json (607 past PSes)
   - Embeds each visible PS title+description via SW→offscreen
   - Computes cosine similarity locally (pure JS, no ML in content)
   - Shows similarity badge when score >= SIMILARITY_THRESHOLD

   WHY ONLY 10 ROWS WERE TAGGED (root cause):
   init() ran once at page load, found 10 rows in the DOM
   (DataTables default pageLength=10), injected badges, done.
   Nothing listened for DataTables redraws.  When the user
   changed page length to 100, DataTables fired draw.dt and
   swapped new rows into the DOM -- but no code responded.

   FIX -- three-layer lifecycle:
   1. processVisibleRows()  -- idempotent core injection loop.
      Skips rows already marked data-sih-injected="true".
      Sets that marker BEFORE async work to prevent races.

   2. injectDTListener()  -- injects a <script> into the page
      JS context (which has jQuery/DataTables).  Subscribes to
      draw.dt on #dataTablePS.  Fires processVisibleRows() on
      every draw: pagination, page-length, sort, search.

   3. setupMutationFallback()  -- MutationObserver on the
      tbody, childList:true, subtree:FALSE.  Only fires when
      DataTables adds/removes <tr> elements; our own injections
      (inside <td>, which are grandchildren+) are invisible
      to it.  NO infinite loop possible.

   Records accumulate in allRecords Map as pages are visited.
   Filter sidebar is built once, then options grow incrementally.

   SIH 2026 confirmed column layout (tbody rows, no real thead):
     [0] S.No  [1] Org  [2] Title<a>+modal  [3] Category
     [4] PS ID  [5] Ideas  [6] Theme  [7] Date
   ============================================================ */

"use strict";

// --- Constants -----------------------------------------------
const TABLE_ID           = "dataTablePS";
const STORAGE_KEY_PREFIX = "sih_ps_";
const SANITY_MIN_ROWS    = 1;
const EXTRACTOR_VERSION  = "SIH2026-DATATABLES-LIFECYCLE v0.4.0";

// Confirmed column indices -- SIH 2026 actual page source
const COL = { org: 1, titleCell: 2, category: 3, psId: 4, theme: 6 };

/**
 * Normalize PS IDs between the live SIH portal (e.g. "SIH26001") and
 * our static datasets which use bare numeric strings (e.g. "26001").
 *
 *   normalizePSId("SIH26001") → "26001"
 *   normalizePSId("26001")    → "26001"   (no-op)
 */
function normalizePSId(raw) {
  return String(raw).replace(/^SIH/i, "").trim();
}

// --- Historical similarity constants -------------------------
// Bundled local dataset (no GitHub required).
// The file lives at extension/data/historical_embeddings.json and is declared
// in manifest web_accessible_resources so the content script can fetch it.
// To switch to GitHub later, replace this with the raw GitHub URL and remove
// the web_accessible_resources entry.
const HISTORICAL_DATA_URL =
  chrome.runtime.getURL("data/historical_embeddings.json");

// Cosine similarity score threshold to show a match badge.
// 0.80 = strong topical overlap; lower = more matches shown.
const SIMILARITY_THRESHOLD = 0.80;

// Maximum number of past matches to show per PS row.
const MAX_MATCHES_SHOWN = 3;

// Storage key for the cached historical dataset.
const HIST_CACHE_KEY = "sih_hist_cache";
const HIST_CACHE_VER_KEY = "sih_hist_cache_version";

const STATUS = {
  unread:   { label: "Unread",   emoji: "\u26AA",       cls: "sih-status--unread"   },
  revisit:  { label: "Revisit",  emoji: "\uD83D\uDFE1", cls: "sih-status--revisit"  },
  selected: { label: "Selected", emoji: "\uD83D\uDFE2", cls: "sih-status--selected" },
  rejected: { label: "Rejected", emoji: "\uD83D\uDFE5", cls: "sih-status--rejected" },
};
const STATUS_CYCLE = ["unread", "revisit", "selected", "rejected"];

// --- State ---------------------------------------------------
// Accumulates as pages/draws reveal more PS.  Never cleared.
const allRecords = new Map(); // psId -> { psId, title, org, cat, theme, desc }

// Shared filter state -- mutated by sidebar controls
const filterState = { status: "all", theme: "all", category: "all", search: "",
                      teamFitMin: 0, sortFit: "none" };

let sidebarBuilt = false;

// Historical dataset: loaded once, cached in storage.
// null = not loaded yet. false = failed (non-fatal, similarity badges hidden).
let historicalData = null;
let historicalDataLoading = false;

console.log("[SIH Copilot] Extractor version: " + EXTRACTOR_VERSION);

// --- Historical similarity layer -----------------------------

/**
 * Cosine similarity between two normalized number arrays.
 * Vectors from all-MiniLM-L6-v2 with normalize:true are unit vectors,
 * so cosine similarity == dot product.
 */
function cosineSim(a, b) {
  var dot = 0;
  var n = Math.min(a.length, b.length);
  for (var i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Load historical dataset from chrome.storage.local cache,
 * or fetch from HISTORICAL_DATA_URL if not cached.
 * Returns the dataset object or null on failure.
 */
async function loadHistoricalData() {
  if (historicalData) return historicalData;
  if (historicalDataLoading) {
    // Wait for the in-flight load to finish
    return new Promise(function(resolve) {
      var check = setInterval(function() {
        if (!historicalDataLoading) { clearInterval(check); resolve(historicalData || null); }
      }, 100);
    });
  }

  historicalDataLoading = true;
  try {
    // Try cached copy first
    var stored = await new Promise(function(resolve) {
      chrome.storage.local.get([HIST_CACHE_KEY], resolve);
    });
    if (stored[HIST_CACHE_KEY] && stored[HIST_CACHE_KEY].records) {
      historicalData = stored[HIST_CACHE_KEY];
      console.log("[SIH Copilot] Historical dataset: loaded from cache,",
        historicalData.totalRecords, "records, version", historicalData.version);
      return historicalData;
    }

    // Cache miss — fetch from network
    historicalData = await fetchHistoricalData();
    return historicalData;
  } catch (err) {
    console.warn("[SIH Copilot] Historical data unavailable:", err.message || err);
    historicalData = false;
    return null;
  } finally {
    historicalDataLoading = false;
  }
}

async function fetchHistoricalData() {
  console.log("[SIH Copilot] Fetching historical dataset...");
  var resp = await fetch(HISTORICAL_DATA_URL);
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  var data = await resp.json();
  if (!data.records || !Array.isArray(data.records)) throw new Error("Invalid format");

  console.log("[SIH Copilot] Historical dataset fetched:",
    data.totalRecords, "records, version", data.version);

  // Cache for subsequent page loads (fire-and-forget)
  chrome.storage.local.set({ [HIST_CACHE_KEY]: data }).catch(function(e) {
    console.warn("[SIH Copilot] Could not cache historical data:", e);
  });

  return data;
}

/**
 * Request a 384-dim embedding for `text` via the Service Worker,
 * which proxies it to the offscreen Transformers.js process.
 * Returns number[384] or null on failure.
 */
async function getEmbedding(text) {
  try {
    var resp = await chrome.runtime.sendMessage({ type: "EMBED", text: text });
    if (resp && resp.ok) return resp.vector;
    console.warn("[SIH Copilot] Embedding failed:", resp && resp.error);
    return null;
  } catch (err) {
    console.warn("[SIH Copilot] Embedding request error:", err);
    return null;
  }
}

/**
 * Detect which SIH year we are currently browsing.
 * Reads the year from the portal URL pattern: sih.gov.in/sihYYYYPS
 * Falls back to the page title, then to the current calendar year.
 * Called once at init; result is stored in CURRENT_YEAR.
 *
 * This makes the same-year exclusion future-proof:
 *   SIH 2027 → excludes 2027 records automatically.
 */
function detectCurrentYear() {
  // Primary: URL contains "sih2026PS", "sih2027PS", etc.
  var urlMatch = location.href.match(/sih(\d{4})PS/i);
  if (urlMatch) return parseInt(urlMatch[1], 10);

  // Fallback 1: four-digit year anywhere in the page title
  var titleMatch = document.title.match(/\b(20\d{2})\b/);
  if (titleMatch) return parseInt(titleMatch[1], 10);

  // Fallback 2: current calendar year (should never be needed)
  return new Date().getFullYear();
}

// Computed once when the content script loads.
var CURRENT_YEAR = detectCurrentYear();
console.log("[SIH Copilot] Detected portal year:", CURRENT_YEAR);

// ─── Phase 3: Team-fit scoring (semantic hybrid) ─────────────────────────────
//
// DESIGN: Pure semantic, no theme/category metadata in the score.
// SIH 2026 theme labels are severely misassigned (e.g. dementia app → "Space
// Technology", land records → "MedTech/BioTech"). Using them would corrupt
// scores. Theme/Category are retained in the tooltip for transparency only.
// See DECISIONS.md for full rationale.
//
// OFFLINE (generate-domain-relevance.js):
//   PS embedding (384-dim) ↔ domain prototype embedding (384-dim)
//   → cosine similarity per domain → domain_relevance_2026.json
//
// RUNTIME (here):
//   domainRel (precomputed) × softmax normalization (T=0.08)
//   → skill-weighted average → Team Fit 0-100
//   No model inference at runtime.

const SKILL_MATRIX_KEY  = "sih_skill_matrix";
const DOMAIN_REL_URL    = chrome.runtime.getURL("data/domain_relevance_2026.json");
const SOFTMAX_TEMP      = 0.08; // sharpens discrimination between domains

// Canonical domain order — must match generate-domain-relevance.js
const DOMAIN_KEYS   = ["AI/ML", "Web", "Hardware", "Blockchain", "GIS", "Biotech", "Mobile"];
const DOMAIN_LABELS = {
  "AI/ML":       "AI / ML",
  "Web":         "Web Dev",
  "Hardware":    "Hardware / IoT",
  "Blockchain":  "Blockchain / Security",
  "GIS":         "GIS / Geospatial",
  "Biotech":     "Biotech / HealthTech",
  "Mobile":      "Mobile Apps",
};
const DOMAIN_EMOJI = {
  "AI/ML": "🤖", "Web": "🌐", "Hardware": "🔧",
  "Blockchain": "🔐", "GIS": "🗺️", "Biotech": "🧬", "Mobile": "📱",
};

// In-memory caches
var _skillMatrix  = null;   // { "AI/ML": 5, ... } or null
var _domainRelMap = null;   // Map<normalizedPsId, { "AI/ML": 0.43, ... }>
var _domainTagMap = null;   // Map<normalizedPsId, domainTag string | null>

// ─── Skill matrix ─────────────────────────────────────────────────────────────

/**
 * Load skill matrix from chrome.storage.local, cache in _skillMatrix.
 * Returns object { "AI/ML": n, ... } or null if user hasn't saved one yet.
 */
async function loadSkillMatrix() {
  if (_skillMatrix !== null) return _skillMatrix;
  try {
    var stored = await new Promise(function(resolve) {
      chrome.storage.local.get([SKILL_MATRIX_KEY], resolve);
    });
    _skillMatrix = stored[SKILL_MATRIX_KEY] || null;
    return _skillMatrix;
  } catch (err) {
    return null;
  }
}

// ─── Domain relevance data ───────────────────────────────────────────────────

/**
 * Load precomputed domain relevance vectors from the bundled JSON.
 * Returns a Map<psId, { "AI/ML": 0.43, ... }> or null on failure.
 * Cached after first load — no re-fetching.
 */
async function loadDomainRelevance() {
  if (_domainRelMap !== null) return _domainRelMap;
  try {
    var resp = await fetch(DOMAIN_REL_URL);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    var data = await resp.json();
    if (!data.records || !Array.isArray(data.records)) throw new Error("Invalid format");
    _domainRelMap = new Map();
    _domainTagMap = new Map();
    data.records.forEach(function(r) {
      var key = String(r.psId); // JSON already has normalized IDs (e.g. "26001")
      _domainRelMap.set(key, r.domainRel);
      if (r.domainTag) _domainTagMap.set(key, r.domainTag);
    });
    console.log("[SIH Copilot] Domain relevance loaded:", _domainRelMap.size, "PSs");
    return _domainRelMap;
  } catch (err) {
    console.warn("[SIH Copilot] Domain relevance unavailable:", err.message);
    _domainRelMap = new Map(); // empty — graceful degradation
    _domainTagMap = new Map();
    return _domainRelMap;
  }
}

// ─── Scoring engine ───────────────────────────────────────────────────────────

/**
 * Compute softmax-normalized relevance across all 7 domains.
 * Temperature T=0.08 sharpens discrimination: the top domain gets ~0.85-0.95
 * weight while semantically unrelated domains drop toward 0.
 *
 * Returns Float32Array-like object indexed by DOMAIN_KEYS.
 */
function softmaxDomainRel(rawRel) {
  var expVals = DOMAIN_KEYS.map(function(d) {
    return Math.exp((rawRel[d] || 0) / SOFTMAX_TEMP);
  });
  var expSum = expVals.reduce(function(a, b) { return a + b; }, 0);
  var result = {};
  DOMAIN_KEYS.forEach(function(d, i) {
    result[d] = expVals[i] / expSum;
  });
  return result;
}

/**
 * Compute Team Fit for a single PS given its domain relevance and the user's skill matrix.
 *
 * Formula:
 *   softmax_rel[d] = softmax(rawRel, T=0.08)[d]    -- sums to 1.0
 *   TeamFit = Σ_d ( softmax_rel[d] × skill[d]/10 ) × 100   (0–100)
 *
 * A team with max skill in the dominant domain of a PS gets ~85–95.
 * A team with no skill in the dominant domain gets ~5–15.
 *
 * @param {Object}  rawRel      { "AI/ML": 0.43, "Web": 0.14, ... } from domainRelMap
 * @param {Object}  skillMatrix { "AI/ML": 10, "Web": 0, ... }
 * @returns {{ score, softmaxRel, rawRel, primaryDomain, topDomains }}
 *          or null if either argument is missing.
 */
function computeTeamFit(rawRel, skillMatrix) {
  if (!rawRel || !skillMatrix) return null;

  var smRel = softmaxDomainRel(rawRel);

  var teamFit = 0;
  DOMAIN_KEYS.forEach(function(d) {
    teamFit += smRel[d] * ((skillMatrix[d] || 0) / 10);
  });
  var score = Math.round(teamFit * 100);

  // Primary domain = highest raw cosine similarity
  var primaryDomain = DOMAIN_KEYS.reduce(function(best, d) {
    return (rawRel[d] || 0) > (rawRel[best] || 0) ? d : best;
  }, DOMAIN_KEYS[0]);

  // Top 3 domains by softmax weight (for tooltip)
  var topDomains = DOMAIN_KEYS
    .map(function(d) { return { d: d, sm: smRel[d], raw: rawRel[d] || 0 }; })
    .sort(function(a, b) { return b.sm - a.sm; })
    .slice(0, 3);

  return { score: score, softmaxRel: smRel, rawRel: rawRel,
           primaryDomain: primaryDomain, topDomains: topDomains };
}

/**
 * Create a team-fit pill badge element.
 * Color: green ≥70, amber 40-69, red <40.
 * Hover tooltip shows per-domain breakdown of the actual calculation.
 */
function createTeamFitBadge(fit, record) {
  var pill = document.createElement("span");
  pill.className = "sih-fit-pill" +
    (fit.score >= 70 ? " sih-fit-pill--high" :
     fit.score >= 40 ? " sih-fit-pill--mid"  : " sih-fit-pill--low");

  var icon = fit.score >= 70 ? "⭐" : fit.score >= 40 ? "🔶" : "🔻";
  pill.textContent = icon + " " + fit.score;

  // Tooltip: show top-3 domain breakdown + SIH metadata for transparency
  var breakdown = fit.topDomains.map(function(t) {
    var skillVal = (_skillMatrix && _skillMatrix[t.d] !== undefined) ? _skillMatrix[t.d] : "?";
    var relPct   = Math.round(t.raw * 100);
    return DOMAIN_EMOJI[t.d] + " " + DOMAIN_LABELS[t.d] +
           ": " + relPct + "% relevance × skill " + skillVal + "/10";
  }).join("\n");

  var theme = (record && record.theme) ? record.theme : "—";
  var cat   = (record && record.category) ? record.category : "—";

  pill.title =
    "Team Fit: " + fit.score + "/100\n" +
    "(semantic embedding · no ML at runtime)\n\n" +
    "Top domains:\n" + breakdown + "\n\n" +
    "Primary: " + DOMAIN_LABELS[fit.primaryDomain] + "\n" +
    "SIH Theme: " + theme + "\n" +
    "SIH Category: " + cat;

  return pill;
}

/**
 * Non-blocking: load domain relevance + skill matrix, compute fit, store on record,
 * inject badge. If domain relevance not available for this psId, silently skips.
 */
async function injectTeamFitBadge(record, cell) {
  try {
    var skillMatrix = await loadSkillMatrix();
    if (!skillMatrix) return; // user hasn't saved a skill matrix yet

    var domainRelMap = await loadDomainRelevance();
    var rawRel = domainRelMap.get(normalizePSId(record.psId));
    if (!rawRel) return; // psId not in domain_relevance_2026.json

    var fit = computeTeamFit(rawRel, skillMatrix);
    if (!fit) return;

    record._fitScore = fit.score;
    record._fitData  = fit; // keep for recompute-in-place

    var badge = createTeamFitBadge(fit, record);
    badge.dataset.fitBadge = "1";
    var wrap = cell.querySelector(".sih-controls");
    if (wrap) wrap.appendChild(badge);
    else      cell.insertBefore(badge, cell.firstChild);
  } catch (err) {
    console.warn("[SIH Copilot] Team-fit badge error for PS", record.psId, ":", err);
  }
}

/**
 * Build the informational major-domain tag pill.
 * Tag is purely decorative — it NEVER affects Team Fit score or filtering.
 * @param {string} tag  e.g. "ML", "GIS", "Blockchain"
 */
function createDomainTagBadge(tag) {
  var span = document.createElement("span");
  span.className = "sih-domain-tag";
  span.textContent = tag;
  span.title = "Major technical domain of this PS (informational only)";
  return span;
}

/**
 * Non-blocking: look up the precomputed domainTag for this PS and inject it.
 * Fires immediately after row injection — no skill matrix required.
 * If the PS has no confident tag (domainTag === null / absent), silently skips.
 */
async function injectDomainTag(record, cell) {
  try {
    await loadDomainRelevance(); // ensures _domainTagMap is populated (cached)
    if (!_domainTagMap) return;
    var tag = _domainTagMap.get(normalizePSId(record.psId));
    if (!tag) return; // PS is ambiguous — no tag assigned

    var badge = createDomainTagBadge(tag);
    badge.dataset.domainTag = "1";
    var wrap = cell.querySelector(".sih-controls");
    if (wrap) wrap.appendChild(badge);
    else      cell.insertBefore(badge, cell.firstChild);
  } catch (err) {
    // purely informational — fail silently
  }
}

/**
 * Recompute _fitScore for ALL known records after a skill change.
 * Updates DOM badges in-place. O(226 × 7) arithmetic — no model inference.
 */
function recomputeAllFitScores() {
  if (!_skillMatrix || !_domainRelMap) return;

  allRecords.forEach(function(rec) {
    // normalizePSId strips the "SIH" prefix the portal prepends ("SIH26001" → "26001")
    var rawRel = _domainRelMap.get(normalizePSId(rec.psId));
    if (!rawRel) return;
    var fit = computeTeamFit(rawRel, _skillMatrix);
    if (!fit) return;
    rec._fitScore = fit.score;
    rec._fitData  = fit;
  });

  // Update DOM badges in-place
  var table = document.getElementById(TABLE_ID);
  if (!table) return;
  var rows = table.querySelectorAll(":scope > tbody > tr[data-sih-psid]");
  rows.forEach(function(row) {
    var rec = allRecords.get(row.dataset.sihPsid);
    if (!rec || rec._fitScore === undefined) return;
    var cell = row.querySelector("td");
    if (!cell) return;
    var old = cell.querySelector("[data-fit-badge='1']");
    if (old) old.remove();
    if (!rec._fitData) return;
    var badge = createTeamFitBadge(rec._fitData, rec);
    badge.dataset.fitBadge = "1";
    var wrap = cell.querySelector(".sih-controls");
    if (wrap) wrap.appendChild(badge);
    else cell.insertBefore(badge, cell.firstChild);
  });
}

/**
 * Sort visible rows in the table tbody by _fitScore.
 * direction: 'desc' (high→low) or 'asc' (low→high).
 * Non-PS rows are left in place.
 */
function applySortByFit(table, direction) {
  if (direction === "none") return;
  var tbody = table.querySelector(":scope > tbody");
  if (!tbody) return;

  var rows = Array.from(tbody.querySelectorAll(":scope > tr[data-sih-psid]"))
    .filter(function(r) { return r.style.display !== "none"; });

  rows.sort(function(a, b) {
    var sa = (allRecords.get(a.dataset.sihPsid) || {})._fitScore;
    var sb = (allRecords.get(b.dataset.sihPsid) || {})._fitScore;
    sa = (sa === undefined) ? -1 : sa;
    sb = (sb === undefined) ? -1 : sb;
    return direction === "asc" ? sa - sb : sb - sa;
  });

  rows.forEach(function(r) { tbody.appendChild(r); });
}



/**
 * Find the top-N historical PSes most similar to queryVec.
 * excludeYear: records from this year are excluded (prevents self-matching
 * the current portal's own records, e.g. SIH 2026 vs SIH 2026 at 100%).
 * Returns array of { psId, year, title, organization, score }, sorted desc.
 */
function findSimilar(queryVec, dataset, threshold, maxN, excludeYear) {
  var matches = [];
  var records = dataset.records;
  for (var i = 0; i < records.length; i++) {
    var rec = records[i];
    if (excludeYear !== undefined && rec.year === excludeYear) continue; // skip same-year
    var score = cosineSim(queryVec, rec.embedding);
    if (score >= threshold) {
      matches.push({ psId: rec.psId, year: rec.year, title: rec.title,
                     organization: rec.organization, score: score });
    }
  }
  matches.sort(function(a, b) { return b.score - a.score; });
  return matches.slice(0, maxN);
}

/**
 * Build the similarity badge DOM element for a PS row.
 * Shows a compact pill "🔁 SIH 2024 (87%)" that expands on click
 * to list all matching past PSes with scores and truncated titles.
 */
function createSimilarityBadge(matches) {
  var wrap = document.createElement("div");
  wrap.className = "sih-sim-wrap";
  if (matches.length === 0) return wrap;

  var top  = matches[0];
  var pct  = Math.round(top.score * 100);
  var pill = document.createElement("span");
  pill.className = "sih-sim-pill";
  pill.title     = "Similar to past SIH problem statements \u2014 click to expand";

  var label = matches.length > 1
    ? "\uD83D\uDD01 " + matches.length + " past matches"
    : "\uD83D\uDD01 SIH " + top.year + " (" + pct + "%)";
  pill.textContent = label;

  // Expandable detail panel
  var detail = document.createElement("div");
  detail.className  = "sih-sim-detail";
  detail.style.display = "none";

  matches.forEach(function(m) {
    var mpct = Math.round(m.score * 100);
    var item = document.createElement("div");
    item.className = "sih-sim-item";
    var shortTitle = m.title.length > 75 ? m.title.slice(0, 75) + "\u2026" : m.title;
    item.innerHTML =
      "<span class='sih-sim-score'>" + mpct + "%</span> " +
      "<span class='sih-sim-year'>SIH\u00A0" + m.year + "</span> " +
      "<span class='sih-sim-title' title='" + (m.organization || "").replace(/'/g, "\u2019") + "'>" +
        shortTitle +
      "</span>";
    detail.appendChild(item);
  });

  pill.addEventListener("click", function(e) {
    e.stopPropagation();
    var open = detail.style.display !== "none";
    detail.style.display = open ? "none" : "block";
    pill.classList.toggle("sih-sim-pill--open", !open);
  });

  wrap.appendChild(pill);
  wrap.appendChild(detail);
  return wrap;
}

// --- Storage helpers -----------------------------------------

async function loadRecord(psId) {
  const key = STORAGE_KEY_PREFIX + psId;
  return new Promise(function(resolve) {
    chrome.storage.local.get([key], function(result) {
      resolve(result[key] || { psId: psId, status: "unread", notes: "", lastViewed: null });
    });
  });
}

async function saveRecord(record) {
  const key = STORAGE_KEY_PREFIX + record.psId;
  record.lastViewed = new Date().toISOString().slice(0, 10);
  return new Promise(function(resolve) {
    chrome.storage.local.set({ [key]: record }, resolve);
  });
}

// --- Row data extraction -------------------------------------
/**
 * Extract PS data from a single <tr>.
 * :scope > td -- direct <td> children only; avoids nested modal tables.
 * Returns null for non-PS rows (DT header, empty rows, etc.).
 */
function extractRowRecord(row) {
  const cells = row.querySelectorAll(":scope > td");
  if (cells.length < 7) return null;

  const psId = cells[COL.psId].textContent.trim();
  if (!psId) return null;

  // Title: first TEXT_NODE of the <a data-toggle="modal">.
  // anchor.textContent also includes the hidden modal body -- we don't want that.
  const titleAnchor = cells[COL.titleCell].querySelector("a[data-toggle='modal']");
  let title = "";
  if (titleAnchor) {
    for (const node of titleAnchor.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        title = node.textContent.trim();
        if (title) break;
      }
    }
    if (!title) title = titleAnchor.textContent.trim();
  }
  if (!title) return null;

  // Description from modal's labeled table (portal misuses <thead> for body rows).
  let description = "";
  const modalTable = cells[COL.titleCell].querySelector("table");
  if (modalTable) {
    for (const mRow of modalTable.querySelectorAll("tr")) {
      const th = mRow.querySelector("th");
      const td = mRow.querySelector("td");
      if (th && td && th.textContent.trim().toLowerCase() === "description") {
        description = td.textContent.trim();
        break;
      }
    }
  }

  return {
    psId:         psId,
    title:        title,
    organization: cells[COL.org].textContent.trim(),
    category:     cells[COL.category].textContent.trim(),
    theme:        cells[COL.theme].textContent.trim(),
    description:  description,
    _row:         row,
  };
}

// --- Core: idempotent visible-row processor ------------------
/**
 * Scans :scope > tbody > tr rows.  For each un-injected row:
 *   1. Extracts PS data.
 *   2. Sets data-sih-injected="true" immediately (before async work)
 *      so a concurrent call won't double-inject the same row.
 *   3. Injects the SIH Copilot badge + notes UI.
 *
 * Rows already marked data-sih-injected="true" are skipped.
 * The marker persists on the DOM node even when DataTables detaches
 * it, so returning to a previously-seen page never duplicates badges.
 *
 * @param {HTMLTableElement} table
 * @param {object} [drawInfo]  -- logging context; optional
 */
async function processVisibleRows(table, drawInfo) {
  const rows = Array.from(table.querySelectorAll(":scope > tbody > tr"));
  const toInject = [];
  let alreadyDone = 0;
  let nonPS = 0;

  for (const row of rows) {
    if (row.dataset.sihInjected === "true") { alreadyDone++; continue; }
    const rec = extractRowRecord(row);
    if (!rec) { nonPS++; continue; }

    // Mark BEFORE async injection to prevent race-condition double-inject.
    row.dataset.sihInjected = "true";
    row.dataset.sihPsid     = rec.psId;
    allRecords.set(rec.psId, rec);
    toInject.push(rec);
  }

  // -- Diagnostics --
  if (drawInfo) {
    const src   = drawInfo.initial ? "Initial draw" : "DataTables draw";
    const extra = drawInfo.source  ? " [" + drawInfo.source + "]" : "";
    console.log("[SIH Copilot] " + src + extra + ":", {
      page:          drawInfo.page !== undefined ? "page " + (drawInfo.page + 1) : "?",
      pageLength:    drawInfo.pageLength,
      recordsTotal:  drawInfo.recordsTotal,
      visibleRows:   rows.length,
      newlyTagged:   toInject.length,
      alreadyTagged: alreadyDone,
      skippedNonPS:  nonPS,
      totalKnownPS:  allRecords.size,
    });
  }

  if (toInject.length === 0) {
    updateStats();
    return;
  }

  // Inject UI into newly seen rows
  await Promise.all(toInject.map(function(r) { return injectIntoRow(r); }));

  // Grow sidebar dropdowns with any newly discovered themes/categories
  updateSidebarOptions();
  updateStats();

  // Build sidebar on first successful extraction
  if (!sidebarBuilt) {
    buildFilterSidebar();
    sidebarBuilt = true;
  }
}

// --- Page-world: DataTables draw listener --------------------
/**
 * Injects a <script> into the page's JS execution context so it
 * can access window.jQuery and the DataTables API.
 *
 * The injected code:
 *   - Polls until $.fn.dataTable.isDataTable('#dataTablePS') is true
 *     (up to 40 x 250 ms = 10 s)
 *   - Subscribes to draw.dt (fires on pagination, page-length change,
 *     search, sort)
 *   - Posts {type:'draw', page, pageLength, recordsTotal} back via
 *     window.postMessage for each draw.
 *   - Also posts once immediately for the current render state.
 *
 * The content-script side receives these messages and calls
 * processVisibleRows(), which is idempotent.
 */
function injectDTListener(table, onMsg) {
  const ch = "sih-dt-" + Date.now();
  const chJson = JSON.stringify(ch);

  window.addEventListener("message", function handler(e) {
    if (e.source !== window) return;
    if (!e.data || e.data._sih !== ch) return;
    onMsg(e.data);
  });

  const s = document.createElement("script");
  s.textContent = "(function(){" +
    "var ch=" + chJson + ";" +
    "function post(d){d._sih=ch;window.postMessage(d,'*');}" +
    "var n=0;" +
    "function setup(){" +
      "var jq=window.jQuery||window.$," +
          "el=document.getElementById('dataTablePS');" +
      "if(jq&&el&&jq.fn.dataTable&&jq.fn.dataTable.isDataTable&&jq.fn.dataTable.isDataTable(el)){" +
        "var api=jq(el).DataTable();" +
        // Subscribe to every draw event
        "jq(el).on('draw.dt',function(){" +
          "var i=api.page.info();" +
          "post({type:'draw',page:i.page,pageLength:i.length," +
               "recordsDisplay:i.recordsDisplay,recordsTotal:i.recordsTotal});" +
        "});" +
        // Fire once for the current page
        "var i=api.page.info();" +
        "var total=api.rows().count();" +
        "console.log('[SIH Copilot] DataTables listener registered. Total records:',total);" +
        "post({type:'draw',page:i.page,pageLength:i.length," +
             "recordsDisplay:i.recordsDisplay,recordsTotal:i.recordsTotal," +
             "initial:true,dtTotal:total});" +
      "}else if(n++<40){setTimeout(setup,250);}" +
      "else{post({type:'error',err:'DataTables not found after 10 s'});}" +
    "}" +
    "setup();" +
  "})();";
  document.documentElement.appendChild(s);
  s.remove();
}

// --- MutationObserver fallback -------------------------------
/**
 * Watches the tbody for <tr> additions (DataTables attaching rows).
 *
 * Key: childList:true, subtree:FALSE
 *   - Fires only when <tr> elements are added/removed as direct children
 *     of tbody -- exactly what DataTables does during redraws.
 *   - Our own badge injections add <div>/<span> INSIDE <td> elements,
 *     which are grandchildren+ of tbody.  subtree:false means the
 *     observer never sees those changes.  NO INFINITE LOOP possible.
 *
 * Debounced 80 ms so that if DataTables adds 100 rows in a batch
 * we fire processVisibleRows only once when it settles.
 */
function setupMutationFallback(table) {
  const tbody = table.querySelector(":scope > tbody");
  if (!tbody) return;

  let debounce;
  const obs = new MutationObserver(function(mutations) {
    var hasNewRows = mutations.some(function(m) {
      return Array.from(m.addedNodes).some(function(n) { return n.nodeName === "TR"; });
    });
    if (!hasNewRows) return;
    clearTimeout(debounce);
    debounce = setTimeout(function() {
      processVisibleRows(table, { source: "mutationFallback" });
    }, 80);
  });

  obs.observe(tbody, { childList: true, subtree: false });
}

// --- Badge / notes injection ---------------------------------
function createBadge(record, psRecord) {
  const badge = document.createElement("span");
  badge.className = "sih-badge " + STATUS[psRecord.status].cls;
  badge.dataset.sihPsid = record.psId;
  badge.title = "Click to cycle status";
  badge.textContent = STATUS[psRecord.status].emoji + " " + STATUS[psRecord.status].label;

  badge.addEventListener("click", async function(e) {
    e.stopPropagation();
    const cur = record._row._sihRecord || { psId: record.psId, status: "unread", notes: "" };
    cur.status = STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur.status) + 1) % STATUS_CYCLE.length];
    record._row._sihRecord = cur;
    await saveRecord(cur);
    badge.className = "sih-badge " + STATUS[cur.status].cls;
    badge.textContent = STATUS[cur.status].emoji + " " + STATUS[cur.status].label;
  });
  return badge;
}

let _globalNotesModal = null;
let _currentNotesRecord = null;
let _currentNotesBtn = null;

function getGlobalNotesModal() {
  if (_globalNotesModal) return _globalNotesModal;

  const overlay = document.createElement("div");
  overlay.className = "sih-notes-overlay";
  overlay.style.display = "none";

  const modal = document.createElement("div");
  modal.className = "sih-notes-modal";

  const header = document.createElement("div");
  header.className = "sih-notes-modal-header";
  
  const titleSpan = document.createElement("span");
  titleSpan.className = "sih-notes-modal-title";
  titleSpan.textContent = "Notes";
  
  const closeIcon = document.createElement("button");
  closeIcon.className = "sih-notes-modal-close";
  closeIcon.title = "Close";
  closeIcon.innerHTML = "&times;";

  header.appendChild(titleSpan);
  header.appendChild(closeIcon);

  const psInfo = document.createElement("div");
  psInfo.className = "sih-notes-modal-info";

  const ta = document.createElement("textarea");
  ta.className = "sih-notes-modal-ta";
  ta.placeholder = "Enter/read the complete note here\u2026";

  const footer = document.createElement("div");
  footer.className = "sih-notes-modal-footer";

  const closeBtn = document.createElement("button");
  closeBtn.className = "sih-notes-modal-btn sih-notes-modal-btn--close";
  closeBtn.textContent = "Close";

  const saveBtn = document.createElement("button");
  saveBtn.className = "sih-notes-modal-btn sih-notes-modal-btn--save";
  saveBtn.textContent = "Save";

  footer.appendChild(closeBtn);
  footer.appendChild(saveBtn);

  modal.appendChild(header);
  modal.appendChild(psInfo);
  modal.appendChild(ta);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const closeFn = () => {
    overlay.style.display = "none";
    _currentNotesRecord = null;
    _currentNotesBtn = null;
  };

  closeIcon.addEventListener("click", closeFn);
  closeBtn.addEventListener("click", closeFn);

  // Close on clicking outside modal
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeFn();
  });

  saveBtn.addEventListener("click", async () => {
    if (!_currentNotesRecord) return;
    const cur = _currentNotesRecord._row._sihRecord || { psId: _currentNotesRecord.psId, status: "unread", notes: "" };
    cur.notes = ta.value;
    _currentNotesRecord._row._sihRecord = cur;
    await saveRecord(cur);
    if (_currentNotesBtn) {
      updateNotesBtnText(_currentNotesBtn, cur.notes);
    }
    closeFn();
  });

  _globalNotesModal = { overlay, modal, ta, psInfo };
  return _globalNotesModal;
}

function positionModalNearEvent(modal, e) {
  const btnRect = e.target.getBoundingClientRect();
  const modalRect = modal.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  
  let top = btnRect.bottom + 8;
  let left = btnRect.left;
  
  if (top + modalRect.height > vh - 10) {
    top = btnRect.top - modalRect.height - 8;
  }
  if (top < 10) top = 10;
  
  if (left + modalRect.width > vw - 10) {
    left = vw - modalRect.width - 10;
  }
  if (left < 10) left = 10;
  
  modal.style.top = top + "px";
  modal.style.left = left + "px";
}

function openGlobalNotesModal(record, psRecord, btn, e) {
  const gm = getGlobalNotesModal();
  _currentNotesRecord = record;
  _currentNotesBtn = btn;
  
  gm.psInfo.textContent = "PS " + normalizePSId(record.psId) + " / " + (record.title || "");
  gm.ta.value = psRecord.notes || "";
  
  gm.overlay.style.display = "flex";
  
  // Briefly make modal visible but invisible to measure it for positioning
  gm.modal.style.visibility = "hidden";
  setTimeout(() => {
    positionModalNearEvent(gm.modal, e);
    gm.modal.style.visibility = "visible";
    gm.ta.focus();
  }, 0);
}

function updateNotesBtnText(btn, notes) {
  if (notes && notes.trim().length > 0) {
    btn.textContent = "\uD83D\uDCDD Notes +1";
    btn.classList.add("sih-notes-btn--has-note");
  } else {
    btn.textContent = "\uD83D\uDCDD Notes";
    btn.classList.remove("sih-notes-btn--has-note");
  }
}

function createNotesToggle(record, psRecord) {
  const btn = document.createElement("button");
  btn.className = "sih-notes-btn";
  updateNotesBtnText(btn, psRecord.notes);
  btn.title = "View/edit notes";
  btn.addEventListener("click", function(e) {
    e.stopPropagation();
    openGlobalNotesModal(record, record._row._sihRecord || psRecord, btn, e);
  });
  return btn;
}

async function injectIntoRow(record) {
  const psRecord = await loadRecord(record.psId);
  record._row._sihRecord = psRecord;

  const firstCell = record._row.querySelector("td");
  if (!firstCell) return;

  const wrap = document.createElement("div");
  wrap.className = "sih-controls";
  const badge      = createBadge(record, psRecord);
  const toggle     = createNotesToggle(record, psRecord);
  wrap.appendChild(badge);
  wrap.appendChild(toggle);
  firstCell.insertBefore(wrap, firstCell.firstChild);

  // Phase 2: historical similarity badge (non-blocking)
  injectSimilarityBadge(record, firstCell);

  // Phase 3a: major-domain tag (non-blocking, purely informational)
  injectDomainTag(record, firstCell);

  // Phase 3b: team-fit score badge (non-blocking, requires saved skill matrix)
  injectTeamFitBadge(record, firstCell);
}

/**
 * Non-blocking: compute embedding for this PS and inject similarity badge.
 * Runs entirely in the background after the row's basic UI is already shown.
 */
async function injectSimilarityBadge(record, cell) {
  try {
    // Load historical dataset (cached after first call)
    const dataset = await loadHistoricalData();
    if (!dataset) return; // historical data unavailable — fail silently

    // Text to embed: title + description (matches how historical PSes were embedded)
    const text = (record.title + " " + record.description).trim().slice(0, 512);
    if (!text) return;

    // Request embedding from offscreen doc via SW
    const queryVec = await getEmbedding(text);
    if (!queryVec) return;

    // Compute cosine similarity against historical vectors, excluding current year's own records
    const matches = findSimilar(queryVec, dataset, SIMILARITY_THRESHOLD, MAX_MATCHES_SHOWN, CURRENT_YEAR);

    // Build and insert badge (even if matches=[]; it renders as empty)
    if (matches.length > 0) {
      const simBadge = createSimilarityBadge(matches);
      // Find the controls wrap and append after it
      const controlsWrap = cell.querySelector(".sih-controls");
      if (controlsWrap) {
        controlsWrap.appendChild(simBadge);
      } else {
        cell.insertBefore(simBadge, cell.firstChild);
      }
    }
  } catch (err) {
    // Similarity is a nice-to-have; never let it break the core UI
    console.warn("[SIH Copilot] Similarity badge error for PS", record.psId, ":", err);
  }
}

// --- Filter sidebar ------------------------------------------
/**
 * applyFilters and updateStats use allRecords Map directly so they
 * work across any page length without closing over a stale array.
 */
function applyFilters() {
  const table = document.getElementById(TABLE_ID);
  if (!table) return;
  const rows = Array.from(table.querySelectorAll(":scope > tbody > tr"));
  rows.forEach(function(row) {
    if (!row.dataset.sihPsid) return; // non-PS row
    const rec  = allRecords.get(row.dataset.sihPsid);
    if (!rec) return;
    const uRec = row._sihRecord || { status: "unread" };
    const ms = filterState.status   === "all" || uRec.status  === filterState.status;
    const mt = filterState.theme    === "all" || rec.theme    === filterState.theme;
    const mc = filterState.category === "all" || rec.category === filterState.category;
    const mq = filterState.search   === ""    ||
      row.textContent.toLowerCase().includes(filterState.search.toLowerCase());
    // Team Fit: only apply threshold if skills have been saved and score is computed
    const mf = filterState.teamFitMin === 0 ||
      (rec._fitScore !== undefined && rec._fitScore >= filterState.teamFitMin);
    row.style.display = (ms && mt && mc && mq && mf) ? "" : "none";
  });
  // Apply team-fit sort AFTER visibility is set
  if (filterState.sortFit !== "none") {
    applySortByFit(table, filterState.sortFit);
  }
  updateStats();
}

function updateStats() {
  const el = document.getElementById("sih-filter-stats");
  if (!el) return;
  const table = document.getElementById(TABLE_ID);
  const rows = table ? Array.from(table.querySelectorAll(":scope > tbody > tr")) : [];
  const tagged  = rows.filter(function(r) { return !!r.dataset.sihPsid; }).length;
  const visible = rows.filter(function(r) {
    return r.dataset.sihPsid && r.style.display !== "none";
  }).length;
  el.textContent = visible + " shown / " + tagged + " tagged / " + allRecords.size + " known PS";
}

/**
 * Add any newly discovered theme/category values to the dropdowns
 * without rebuilding the sidebar or resetting current selections.
 */
function updateSidebarOptions() {
  const records   = Array.from(allRecords.values());
  const themes    = [...new Set(records.map(function(r){return r.theme;}).filter(Boolean))].sort();
  const cats      = [...new Set(records.map(function(r){return r.category;}).filter(Boolean))].sort();

  function addMissing(selectId, values) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const cur      = sel.value;
    const existing = new Set(Array.from(sel.options).map(function(o){return o.value;}));
    values.forEach(function(v) {
      if (!existing.has(v)) {
        const opt = document.createElement("option");
        opt.value = v; opt.textContent = v;
        sel.appendChild(opt);
      }
    });
    sel.value = cur; // preserve current selection
  }

  addMissing("sih-f-theme",    themes);
  addMissing("sih-f-category", cats);
}

// Skill domain definitions for the sidebar panel
const SKILL_DOMAINS_UI = [
  { key: "AI/ML",      label: "AI / ML",             emoji: "\uD83E\uDD16" },
  { key: "Web",        label: "Web Development",      emoji: "\uD83C\uDF10" },
  { key: "Mobile",     label: "Mobile Apps",          emoji: "\uD83D\uDCF1" },
  { key: "Hardware",   label: "Hardware / IoT",       emoji: "\uD83D\uDD27" },
  { key: "Blockchain", label: "Blockchain / Security",emoji: "\uD83D\uDD10" },
  { key: "GIS",        label: "GIS / Geospatial",     emoji: "\uD83D\uDDFA\uFE0F" },
  { key: "Biotech",    label: "Biotech / HealthTech", emoji: "\uD83E\uDDEC" },
];

function buildSkillsPanel(matrix) {
  var hasMatrix = !!matrix;
  var rows = SKILL_DOMAINS_UI.map(function(d) {
    var val = (matrix && matrix[d.key] !== undefined) ? matrix[d.key] : 5;
    return "<div class='sih-skill-row'>" +
      "<div class='sih-skill-hdr'>" +
        "<span class='sih-skill-lbl'>" + d.emoji + " " + d.label + "</span>" +
        "<span class='sih-skill-val' id='sih-sv-" + d.key.replace(/[^a-z0-9]/gi, "_") + "'>" + val + "/10</span>" +
      "</div>" +
      "<input type='range' class='sih-skill-slider' id='sih-ss-" + d.key.replace(/[^a-z0-9]/gi, "_") + "'" +
        " min='0' max='10' step='1' value='" + val + "'" +
        " style='--sfill:" + (val * 10) + "%'>" +
    "</div>";
  }).join("");
  return "<div class='sih-skills-section'>" +
    "<button class='sih-skills-toggle' id='sih-skills-toggle'>" +
      "<span id='sih-skills-arrow'>\u25BC</span> My Team Skills" +
    "</button>" +
    "<div class='sih-skills-body' id='sih-skills-body'>" +
      (hasMatrix ? "" : "<p class='sih-skills-hint'>Set your team\u2019s skills to see personalised fit scores.</p>") +
      rows +
      "<div class='sih-skills-save-row'>" +
        "<button class='sih-save-btn' id='sih-save-skills'>Save Skills</button>" +
        "<span class='sih-save-status' id='sih-save-status'></span>" +
      "</div>" +
    "</div>" +
  "</div>";
}

function buildFilterSidebar() {
  document.getElementById("sih-filter-sidebar") &&
    document.getElementById("sih-filter-sidebar").remove();

  const records = Array.from(allRecords.values());
  const themes  = [...new Set(records.map(function(r){return r.theme;}).filter(Boolean))].sort();
  const cats    = [...new Set(records.map(function(r){return r.category;}).filter(Boolean))].sort();

  const sidebar = document.createElement("div");
  sidebar.id = "sih-filter-sidebar";
  sidebar.innerHTML =
    "<div class='sih-sidebar-header'>" +
      "<span class='sih-sidebar-logo'><img src='" + chrome.runtime.getURL("icons/icon48.png") + "' style='width:16px;height:16px;vertical-align:middle;margin-right:6px;border-radius:50%;' alt='Logo'>SIH Copilot</span>" +
      "<button id='sih-sidebar-collapse' title='Collapse'>\u2039</button>" +
    "</div>" +
    "<div class='sih-sidebar-body'>" +

      // ── Standard filters ──────────────────────────────────
      "<label class='sih-filter-label' for='sih-f-search'>Search</label>" +
      "<input id='sih-f-search' class='sih-filter-input' type='text' placeholder='Keywords\u2026' />" +
      "<label class='sih-filter-label' for='sih-f-status'>Status</label>" +
      "<select id='sih-f-status' class='sih-filter-select'>" +
        "<option value='all'>All</option>" +
        STATUS_CYCLE.map(function(s){
          return "<option value='" + s + "'>" + STATUS[s].emoji + " " + STATUS[s].label + "</option>";
        }).join("") +
      "</select>" +
      "<label class='sih-filter-label' for='sih-f-category'>Category</label>" +
      "<select id='sih-f-category' class='sih-filter-select'>" +
        "<option value='all'>All</option>" +
        cats.map(function(c){return "<option value='" + c + "'>" + c + "</option>";}).join("") +
      "</select>" +
      "<label class='sih-filter-label' for='sih-f-theme'>Theme</label>" +
      "<select id='sih-f-theme' class='sih-filter-select'>" +
        "<option value='all'>All</option>" +
        themes.map(function(t){return "<option value='" + t + "'>" + t + "</option>";}).join("") +
      "</select>" +

      // ── Team Fit filter ───────────────────────────────────
      "<div class='sih-section-divider'></div>" +
      "<div class='sih-filter-label'>Team Fit</div>" +
      "<div class='sih-fit-radios'>" +
        "<label class='sih-radio-lbl'><input type='radio' name='sih-fit-f' value='0'   checked> All</label>" +
        "<label class='sih-radio-lbl'><input type='radio' name='sih-fit-f' value='70'>  \u2B50 Strong (70+)</label>" +
        "<label class='sih-radio-lbl'><input type='radio' name='sih-fit-f' value='50'>  \uD83D\uDD36 Good (50+)</label>" +
        "<label class='sih-radio-lbl'><input type='radio' name='sih-fit-f' value='custom'>  Custom</label>" +
      "</div>" +
      "<div class='sih-fit-custom' id='sih-fit-custom' style='display:none'>" +
        "<div class='sih-fit-custom-hdr'>" +
          "<span>Min score</span><span id='sih-fit-custom-val'>65</span>" +
        "</div>" +
        "<input type='range' id='sih-fit-custom-slider' class='sih-skill-slider'" +
          " min='0' max='100' step='5' value='65' style='--sfill:65%'>" +
      "</div>" +

      // ── Sort ──────────────────────────────────────────────
      "<div class='sih-section-divider'></div>" +
      "<label class='sih-filter-label' for='sih-sort-fit'>Sort by Team Fit</label>" +
      "<select id='sih-sort-fit' class='sih-filter-select'>" +
        "<option value='none'>Default / SIH order</option>" +
        "<option value='desc'>Highest \u2192 Lowest</option>" +
        "<option value='asc'>Lowest \u2192 Highest</option>" +
      "</select>" +

      // ── My Team Skills (collapsible) ─────────────────────
      "<div class='sih-section-divider'></div>" +
      buildSkillsPanel(_skillMatrix) +

      // ── Footer ───────────────────────────────────────────
      "<div class='sih-section-divider'></div>" +
      "<div class='sih-filter-stats' id='sih-filter-stats'></div>" +
      "<button id='sih-reset-filters' class='sih-reset-btn'>Reset Filters</button>" +
    "</div>";

  document.body.appendChild(sidebar);

  // ── Collapse toggle ──────────────────────────────────────
  let collapsed = false;
  document.getElementById("sih-sidebar-collapse").addEventListener("click", function() {
    collapsed = !collapsed;
    sidebar.classList.toggle("sih-sidebar--collapsed", collapsed);
    document.getElementById("sih-sidebar-collapse").textContent = collapsed ? "\u203A" : "\u2039";
  });

  // ── Skills panel collapse toggle ─────────────────────────
  var skillsOpen = true;
  document.getElementById("sih-skills-toggle").addEventListener("click", function() {
    skillsOpen = !skillsOpen;
    document.getElementById("sih-skills-body").style.display = skillsOpen ? "" : "none";
    document.getElementById("sih-skills-arrow").textContent = skillsOpen ? "\u25BC" : "\u25B6";
  });

  // ── Standard filter change handler ────────────────────────
  function onFilterChange() {
    filterState.search   = document.getElementById("sih-f-search").value;
    filterState.status   = document.getElementById("sih-f-status").value;
    filterState.category = document.getElementById("sih-f-category").value;
    filterState.theme    = document.getElementById("sih-f-theme").value;
    applyFilters();
  }
  document.getElementById("sih-f-search").addEventListener("input",  onFilterChange);
  document.getElementById("sih-f-status").addEventListener("change", onFilterChange);
  document.getElementById("sih-f-category").addEventListener("change", onFilterChange);
  document.getElementById("sih-f-theme").addEventListener("change",  onFilterChange);

  // ── Team Fit radio buttons ────────────────────────────────
  sidebar.querySelectorAll("input[name='sih-fit-f']").forEach(function(radio) {
    radio.addEventListener("change", function() {
      var customDiv = document.getElementById("sih-fit-custom");
      if (radio.value === "custom") {
        customDiv.style.display = "";
        filterState.teamFitMin = parseInt(document.getElementById("sih-fit-custom-slider").value, 10);
      } else {
        customDiv.style.display = "none";
        filterState.teamFitMin = parseInt(radio.value, 10);
      }
      applyFilters();
    });
  });

  // ── Custom fit slider ────────────────────────────────────
  var customSlider = document.getElementById("sih-fit-custom-slider");
  customSlider.addEventListener("input", function() {
    document.getElementById("sih-fit-custom-val").textContent = customSlider.value;
    customSlider.style.setProperty("--sfill", customSlider.value + "%");
    filterState.teamFitMin = parseInt(customSlider.value, 10);
    applyFilters();
  });

  // ── Sort select ──────────────────────────────────────────
  document.getElementById("sih-sort-fit").addEventListener("change", function() {
    filterState.sortFit = this.value;
    applyFilters();
  });

  // ── Skill sliders: live value display ────────────────────
  SKILL_DOMAINS_UI.forEach(function(d) {
    var safeKey = d.key.replace(/[^a-z0-9]/gi, "_");
    var slider = document.getElementById("sih-ss-" + safeKey);
    var valEl  = document.getElementById("sih-sv-" + safeKey);
    if (!slider) return;
    slider.addEventListener("input", function() {
      valEl.textContent = slider.value + "/10";
      slider.style.setProperty("--sfill", (slider.value * 10) + "%");
    });
  });

  // ── Save skills button ───────────────────────────────────
  document.getElementById("sih-save-skills").addEventListener("click", function() {
    var newMatrix = {};
    SKILL_DOMAINS_UI.forEach(function(d) {
      var safeKey = d.key.replace(/[^a-z0-9]/gi, "_");
      var el = document.getElementById("sih-ss-" + safeKey);
      newMatrix[d.key] = el ? parseInt(el.value, 10) : 5;
    });
    chrome.storage.local.set({ [SKILL_MATRIX_KEY]: newMatrix }, function() {
      _skillMatrix = newMatrix;
      // Remove stale "set your skills" hint if present
      var hint = document.querySelector(".sih-skills-hint");
      if (hint) hint.remove();
      // Recompute scores and re-filter/sort
      recomputeAllFitScores();
      applyFilters();
      // Confirmation
      var status = document.getElementById("sih-save-status");
      status.textContent = "\u2713 Saved";
      status.className = "sih-save-status sih-save-status--ok";
      setTimeout(function() {
        status.textContent = "";
        status.className = "sih-save-status";
      }, 2000);
    });
  });

  // ── Reset all filters ────────────────────────────────────
  document.getElementById("sih-reset-filters").addEventListener("click", function() {
    document.getElementById("sih-f-search").value   = "";
    document.getElementById("sih-f-status").value   = "all";
    document.getElementById("sih-f-category").value = "all";
    document.getElementById("sih-f-theme").value    = "all";
    // Reset team fit radio to All
    var allRadio = sidebar.querySelector("input[name='sih-fit-f'][value='0']");
    if (allRadio) allRadio.checked = true;
    document.getElementById("sih-fit-custom").style.display = "none";
    // Reset sort
    document.getElementById("sih-sort-fit").value = "none";
    filterState.search = ""; filterState.status = "all";
    filterState.category = "all"; filterState.theme = "all";
    filterState.teamFitMin = 0; filterState.sortFit = "none";
    applyFilters();
  });

  updateStats();
}

// --- Main initialisation -------------------------------------
async function init(table) {
  console.log("[SIH Copilot] Extractor version: " + EXTRACTOR_VERSION);

  // Pre-load skill matrix so fit scores are available on first row injection.
  await loadSkillMatrix();

  // Pre-load domain relevance data (57 KB JSON, instant after first load).
  // Runs in parallel with historical data; both will be ready by first row draw.
  loadDomainRelevance().catch(function() {});

  // Kick off historical data load in background immediately;
  // it will be ready by the time the first embedding request fires.
  loadHistoricalData().catch(function() {});


  console.log("[SIH Copilot] Table found: #" + table.id);

  // Step 1: Inject into rows already in the DOM right now.
  //   (DataTables has probably already rendered the default page.)
  await processVisibleRows(table, { initial: true });

  // Step 2: Subscribe to DataTables draw.dt via page-world injection.
  //   Fires on every pagination, page-length change, sort, or search.
  //   processVisibleRows() is idempotent -- safe to call repeatedly.
  injectDTListener(table, async function(msg) {
    if (msg.type === "draw") {
      await processVisibleRows(table, msg);
    } else if (msg.type === "error") {
      console.warn(
        "[SIH Copilot] DataTables draw listener failed:", msg.err,
        "-- MutationObserver fallback remains active."
      );
    }
  });

  // Step 3: MutationObserver fallback on tbody (subtree:false).
  //   Handles any DT redraws that draw.dt might miss.
  //   Our own <div>/<span> injections are inside <td> (grandchildren+)
  //   and are invisible to this observer.  No infinite loop.
  setupMutationFallback(table);
}

// --- Entry point: table may render asynchronously ------------
function waitForTable() {
  const table = document.getElementById(TABLE_ID);
  if (table) { init(table); return; }

  console.log("[SIH Copilot] #dataTablePS not in DOM yet -- watching...");
  let found = false;
  const obs = new MutationObserver(function() {
    const t = document.getElementById(TABLE_ID);
    if (t && !found) { found = true; obs.disconnect(); init(t); }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  setTimeout(function() {
    if (!found) {
      obs.disconnect();
      console.warn("[SIH Copilot] Timed out (30 s) waiting for #dataTablePS.");
    }
  }, 30000);
}

waitForTable();