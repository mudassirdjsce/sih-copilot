/**
 * scripts/generate-domain-tags.js
 *
 * Offline pipeline — run once (or whenever PS data changes).
 *
 * Reads:
 *   data/raw/sih-2026-ps.csv          (226 rows, Problem_Statement_ID column)
 *   data/domain_relevance_2026.json   (existing relevance file)
 *
 * Writes:
 *   data/domain_relevance_2026.json   (same file, adds/updates domainTag per record)
 *
 * Tag vocabulary (high-level, likely end-product):
 *   ML · Web · App · Blockchain · Hardware · GIS · IoT · Cybersecurity · Data · Biotech
 *
 * Classification: weighted keyword scoring on title (3×) + description (1×).
 * Priority used only to break exact score ties; strong evidence always wins.
 * A tag is assigned only when the total score meets a minimum threshold.
 *
 * Usage:
 *   cd scripts && node generate-domain-tags.js
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

// ── Tag definitions ────────────────────────────────────────────────────────
// priority: used only to break exact-score ties (higher = wins)
// patterns: { re: RegExp, w: base weight }
//   Title match weight = w × 3,  description match weight = w × 1
//   Score is additive over all pattern hits.
const TAGS = [
  {
    tag: "Blockchain", priority: 10,
    patterns: [
      { re: /blockchain/gi,          w: 5 },
      { re: /smart.?contract/gi,     w: 5 },
      { re: /distributed.?ledger/gi, w: 5 },
      { re: /cryptocurrency/gi,      w: 4 },
      { re: /\bdefi\b/gi,            w: 4 },
      { re: /\bnft\b/gi,             w: 4 },
      { re: /\bweb3\b/gi,            w: 4 },
      { re: /\bethereum\b/gi,        w: 4 },
      { re: /\bsolidity\b/gi,        w: 4 },
      { re: /decentrali[sz]ed/gi,    w: 1 },
      { re: /crypto.?wallet/gi,      w: 5 },
      { re: /\btokeniz/gi,           w: 4 },
    ],
  },
  {
    tag: "GIS", priority: 9,
    patterns: [
      { re: /\bgis\b/gi,             w: 5 },
      { re: /geospatial/gi,          w: 5 },
      { re: /geo-spatial/gi,         w: 5 },
      { re: /satellite.?imager/gi,   w: 5 },
      { re: /remote.?sensing/gi,     w: 5 },
      { re: /spatial.?analysis/gi,   w: 4 },
      { re: /cartograph/gi,          w: 4 },
      { re: /geodata/gi,             w: 4 },
      { re: /land.?use.?map/gi,      w: 4 },
      { re: /geo-tag/gi,             w: 3 },
    ],
  },
  {
    tag: "Biotech", priority: 8,
    patterns: [
      { re: /genomic/gi,             w: 5 },
      { re: /\bgenome\b/gi,          w: 5 },
      { re: /\bdna\b/gi,             w: 5 },
      { re: /drug.?discov/gi,        w: 5 },
      { re: /bioinformat/gi,         w: 5 },
      { re: /clinical.?trial/gi,     w: 4 },
      { re: /molecular.?bio/gi,      w: 5 },
      { re: /biomarker/gi,           w: 4 },
      { re: /sequencing/gi,          w: 4 },
      { re: /\bprotein\b.{0,30}struct/gi, w: 4 },
      { re: /\bcrispr\b/gi,          w: 5 },
      { re: /epigeneti/gi,           w: 4 },
      { re: /biopolymer/gi,          w: 4 },
      { re: /\bantibod/gi,           w: 4 },
    ],
  },
  {
    tag: "Cybersecurity", priority: 7,
    patterns: [
      { re: /cyber.?secur/gi,        w: 5 },
      { re: /penetration.?test/gi,   w: 5 },
      { re: /\bvulnerabilit/gi,      w: 4 },
      { re: /\bmalware\b/gi,         w: 5 },
      { re: /\bphishing\b/gi,        w: 5 },
      { re: /\bransomware\b/gi,      w: 5 },
      { re: /intrusion.?detection/gi,w: 5 },
      { re: /threat.?intel/gi,       w: 4 },
      { re: /dark.?web/gi,           w: 5 },
      { re: /zero.?day/gi,           w: 5 },
      { re: /\b(?:ids|ips|siem)\b/gi,w: 4 },
      { re: /digital.?forensic/gi,   w: 5 },
      { re: /\bencrypt/gi,           w: 3 },
      { re: /\bfirewall\b/gi,        w: 3 },
    ],
  },
  {
    tag: "Hardware", priority: 6,
    patterns: [
      { re: /\bdrone\b/gi,           w: 4 },
      { re: /\buav\b/gi,             w: 5 },
      { re: /\buas\b/gi,             w: 4 },
      { re: /unmanned.?aerial/gi,    w: 5 },
      { re: /\bpcb\b/gi,             w: 5 },
      { re: /circuit.?board/gi,      w: 5 },
      { re: /prostheti/gi,           w: 5 },
      { re: /exoskeleton/gi,         w: 5 },
      { re: /3d.?print/gi,           w: 4 },
      { re: /robotic.?arm/gi,        w: 5 },
      { re: /autonomous.?robot/gi,   w: 5 },
      { re: /wearable.?device/gi,    w: 4 },
      { re: /haptic/gi,              w: 5 },
    ],
  },
  {
    tag: "IoT", priority: 5,
    patterns: [
      { re: /\biot\b/gi,             w: 5 },
      { re: /internet.?of.?things/gi,w: 5 },
      { re: /sensor.?network/gi,     w: 4 },
      { re: /embedded.?system/gi,    w: 4 },
      { re: /smart.?meter/gi,        w: 4 },
      { re: /smart.?grid/gi,         w: 4 },
      { re: /\brfid\b/gi,            w: 4 },
      { re: /edge.?computing/gi,     w: 3 },
      { re: /sensor.?based/gi,       w: 3 },
      { re: /\bscada\b/gi,           w: 4 },
    ],
  },
  {
    tag: "App", priority: 4,
    patterns: [
      { re: /mobile.?app(?:lication)?/gi, w: 5 },
      { re: /\bandroid\b/gi,         w: 4 },
      { re: /\bios\b.{0,20}app/gi,   w: 4 },
      { re: /smartphone.?app/gi,     w: 5 },
      { re: /\bflutter\b/gi,         w: 4 },
      { re: /react.?native/gi,       w: 4 },
      { re: /cross.?platform.?(?:mobile|app)/gi, w: 5 },
      { re: /native.?mobile/gi,      w: 4 },
    ],
  },
  {
    tag: "ML", priority: 3,
    patterns: [
      { re: /machine.?learning/gi,   w: 4 },
      { re: /deep.?learning/gi,      w: 4 },
      { re: /neural.?network/gi,     w: 4 },
      { re: /\bnlp\b/gi,             w: 4 },
      { re: /natural.?language.?process/gi, w: 4 },
      { re: /computer.?vision/gi,    w: 4 },
      { re: /object.?detection/gi,   w: 4 },
      { re: /image.?classif/gi,      w: 4 },
      { re: /\bllm\b/gi,             w: 4 },
      { re: /large.?language.?model/gi, w: 4 },
      { re: /generative.?ai/gi,      w: 4 },
      { re: /\bai.?model\b/gi,       w: 3 },
      { re: /reinforcement.?learn/gi,w: 4 },
      { re: /transformer.?model/gi,  w: 4 },
    ],
  },
  {
    tag: "Web", priority: 2,
    patterns: [
      { re: /web.?portal/gi,         w: 4 },
      { re: /web.?platform/gi,       w: 4 },
      { re: /web.?application/gi,    w: 4 },
      { re: /online.?portal/gi,      w: 4 },
      { re: /e-governance/gi,        w: 4 },
      { re: /citizen.?portal/gi,     w: 4 },
      { re: /web.?based.?(?:system|platform|solution)/gi, w: 3 },
      { re: /government.?portal/gi,  w: 4 },
    ],
  },
  {
    tag: "Data", priority: 1,
    patterns: [
      { re: /data.?analytics.?platform/gi, w: 5 },
      { re: /data.?pipeline/gi,      w: 4 },
      { re: /data.?warehouse/gi,     w: 5 },
      { re: /business.?intelligence/gi, w: 4 },
      { re: /\betl\b/gi,             w: 4 },
      { re: /data.?lake/gi,          w: 4 },
      { re: /real.?time.?dashboard/gi, w: 3 },
    ],
  },
];

// ── Minimum score to assign any tag (prevents noise) ─────────────────────
const MIN_SCORE = 5;

function classify(title, description) {
  const text = { title: title || "", desc: description || "" };
  const scores = {};

  for (const tagDef of TAGS) {
    let score = 0;
    for (const { re, w } of tagDef.patterns) {
      // Reset lastIndex for global regexes
      re.lastIndex = 0;
      const titleHits = (text.title.match(re) || []).length;
      re.lastIndex = 0;
      const descHits  = (text.desc.match(re) || []).length;
      score += titleHits * w * 3 + descHits * w;
    }
    if (score > 0) {
      scores[tagDef.tag] = { score, priority: tagDef.priority };
    }
  }

  if (Object.keys(scores).length === 0) return null;

  // Pick the tag with the highest score; break ties by priority
  let best = null;
  for (const [tag, { score, priority }] of Object.entries(scores)) {
    if (
      !best ||
      score > best.score ||
      (score === best.score && priority > best.priority)
    ) {
      best = { tag, score, priority };
    }
  }

  return best && best.score >= MIN_SCORE ? best.tag : null;
}

// ── Main ──────────────────────────────────────────────────────────────────
function main() {
  const ROOT   = path.resolve(__dirname, "..");
  const csvPath = path.join(ROOT, "data", "raw", "sih-2026-ps.csv");
  const relPath = path.join(ROOT, "data", "domain_relevance_2026.json");

  console.log("=== SIH Copilot — Domain Tag Generator ===\n");

  // 1. Read CSV → Map<psId, description>
  const csvBuf = fs.readFileSync(csvPath);
  const rows   = parse(csvBuf, { columns: true, skip_empty_lines: true, trim: true });
  const descMap = new Map();
  for (const r of rows) {
    const id = (r["Problem_Statement_ID"] || "").trim();
    if (id) descMap.set(id, (r["Description"] || "").trim());
  }
  console.log(`CSV rows read: ${rows.length}, unique psIds: ${descMap.size}`);

  // 2. Read existing domain_relevance_2026.json
  const relRaw  = fs.readFileSync(relPath, "utf8");
  const relData = JSON.parse(relRaw);

  // 3. Classify each record and attach domainTag
  const counts = {};
  let tagged = 0, untagged = 0;

  for (const rec of relData.records) {
    const psId  = String(rec.psId);
    const title = rec.title  || "";
    const desc  = descMap.get(psId) || "";
    const tag   = classify(title, desc);
    rec.domainTag = tag; // null if not confident
    if (tag) {
      counts[tag] = (counts[tag] || 0) + 1;
      tagged++;
    } else {
      untagged++;
    }
  }

  // 4. Update generatedAt timestamp
  relData.generatedAt = new Date().toISOString();

  // 5. Write back
  fs.writeFileSync(relPath, JSON.stringify(relData, null, 2), "utf8");

  // 6. Report
  console.log(`\nTagged: ${tagged}  Untagged (too ambiguous): ${untagged}`);
  console.log("\nTag distribution:");
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([tag, n]) => console.log(`  ${tag.padEnd(14)} ${n}`));

  // 7. Print sample tags for first 15 records
  console.log("\nSample (first 15 PSs):");
  relData.records.slice(0, 15).forEach(r => {
    console.log(`  ${r.psId}  [${(r.domainTag || "—").padEnd(13)}]  ${r.title.slice(0, 60)}`);
  });

  // 8. Spot-check specific PSs mentioned by the user
  const spotCheck = ["26171", "26013", "26182", "26128", "26177"];
  console.log("\nSpot-check:");
  for (const id of spotCheck) {
    const r = relData.records.find(x => String(x.psId) === id);
    if (r) console.log(`  PS ${id}  [${(r.domainTag || "—").padEnd(13)}]  ${r.title.slice(0, 60)}`);
  }

  console.log("\nWrote:", relPath);
}

main();
