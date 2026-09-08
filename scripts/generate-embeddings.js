/**
 * scripts/generate-embeddings.js
 *
 * Offline pipeline — run ONCE per SIH cycle, not at extension runtime.
 *
 * Reads:
 *   data/raw/SIH_PS_Winners_2024.csv   (324 rows → 247 unique after dedup)
 *   data/raw/sih-2025-ps.csv           (135 rows)
 *   data/raw/sih-2026-ps.csv           (226 rows)
 *
 * Writes:
 *   data/historical_embeddings.json
 *
 * Schema per entry:
 *   { psId, year, title, organization, category, theme, embedding: number[384] }
 *
 * Embedding input: title + " " + description  (per DATA_MODEL.md decision)
 * Model: Xenova/all-MiniLM-L6-v2 (384-dim, MIT license)
 *
 * Usage:
 *   node scripts/generate-embeddings.js
 *
 * This uses @xenova/transformers (the older CommonJS-compatible build).
 * The extension uses @huggingface/transformers; this script uses @xenova/transformers
 * which runs fine in Node.js without WASM restrictions.
 *
 * Install deps first (only needed for this script):
 *   cd scripts && npm install @xenova/transformers csv-parse
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const ROOT      = path.resolve(__dirname, "..");
const DATA_RAW  = path.join(ROOT, "data", "raw");
const OUT_FILE  = path.join(ROOT, "data", "historical_embeddings.json");

// ─── CSV readers ──────────────────────────────────────────────────────────────

function readCsv(filename) {
  const buf = fs.readFileSync(path.join(DATA_RAW, filename));
  return parse(buf, { columns: true, skip_empty_lines: true, trim: true });
}

function normalize2024(rows) {
  const seen = new Set();
  const out  = [];
  for (const r of rows) {
    const id = (r["ID"] || "").trim();
    if (!id || seen.has(id)) continue; // dedup: keep first occurrence
    seen.add(id);
    out.push({
      psId:         id,
      year:         2024,
      title:        (r["Title"]             || "").trim(),
      description:  (r["Description"]       || "").trim(),
      organization: (r["Organisation"]      || "").trim(), // British spelling in source
      category:     (r["Category"]          || "").trim(),
      theme:        (r["Technology_Bucket"] || "").trim(),
    });
  }
  return out;
}

function normalize2025(rows) {
  return rows.map(r => ({
    psId:         (r["Problem_Statement_ID"]    || "").trim(),
    year:         2025,
    title:        (r["Problem_Statement_Title"] || "").trim(),
    description:  (r["Description"]             || "").trim(),
    organization: (r["Organization"]            || "").trim(),
    category:     (r["Category"]               || "").trim(),
    theme:        (r["Theme"]                  || "").trim(),
  })).filter(r => r.psId);
}

function normalize2026(rows) {
  return rows.map(r => ({
    psId:         (r["Problem_Statement_ID"]    || "").trim(),
    year:         2026,
    title:        (r["Problem_Statement_Title"] || "").trim(),
    description:  (r["Description"]             || "").trim(),
    organization: (r["Organization"]            || "").trim(),
    category:     (r["Category"]               || "").trim(),
    theme:        (r["Theme"]                  || "").trim(),
  })).filter(r => r.psId);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== SIH Copilot — Historical Embedding Pipeline ===\n");

  // 1. Load and normalize
  console.log("Loading CSVs...");
  const rows2024 = normalize2024(readCsv("SIH_PS_Winners_2024.csv"));
  const rows2025 = normalize2025(readCsv("sih-2025-ps.csv"));
  const rows2026 = normalize2026(readCsv("sih-2026-ps.csv"));
  const allRows  = [...rows2024, ...rows2025, ...rows2026];

  console.log(`  2024: ${rows2024.length} unique PSes (after dedup from 324)`);
  console.log(`  2025: ${rows2025.length} PSes`);
  console.log(`  2026: ${rows2026.length} PSes`);
  console.log(`  Total: ${allRows.length} PSes\n`);

  // 2. Load model (lazy import so node sees ESM-compatible package)
  console.log("Loading embedding model (Xenova/all-MiniLM-L6-v2)...");
  const { pipeline } = await import("@xenova/transformers");
  const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  console.log("Model ready.\n");

  // 3. Embed each row
  const results = [];
  const BATCH   = 10;
  const total   = allRows.length;

  for (let i = 0; i < total; i += BATCH) {
    const batch = allRows.slice(i, i + BATCH);
    await Promise.all(batch.map(async (row, bi) => {
      const text   = `${row.title} ${row.description}`.trim().slice(0, 512);
      const output = await embedder(text, { pooling: "mean", normalize: true });
      const embedding = Array.from(output.data).map(v => parseFloat(v.toFixed(6)));

      results.push({
        psId:         row.psId,
        year:         row.year,
        title:        row.title,
        organization: row.organization,
        category:     row.category,
        theme:        row.theme,
        embedding,
      });

      const idx = i + bi + 1;
      if (idx % 50 === 0 || idx === total) {
        process.stdout.write(`\r  Embedded ${idx}/${total}...`);
      }
    }));
  }
  console.log(`\n  Done. ${results.length} embeddings generated.`);

  // 4. Sort by year then psId for deterministic output
  results.sort((a, b) => a.year - b.year || String(a.psId).localeCompare(String(b.psId)));

  // 5. Write output
  const out = {
    version:     new Date().toISOString().slice(0, 10), // YYYY-MM-DD
    model:       "Xenova/all-MiniLM-L6-v2",
    dim:         384,
    totalRecords: results.length,
    records:     results,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out), "utf8");
  const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
  console.log(`\nOutput: ${OUT_FILE} (${kb} KB)`);
  console.log(`Version: ${out.version}`);
  console.log("\nDone ✅");
}

main().catch(err => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
