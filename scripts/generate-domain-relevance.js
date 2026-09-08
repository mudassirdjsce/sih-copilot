/**
 * scripts/generate-domain-relevance.js
 * Offline pipeline. Read existing 2026 embeddings, embed 7 domain prototypes,
 * compute cosine similarity for each PS, write data/domain_relevance_2026.json.
 *
 * Usage:  cd scripts && node generate-domain-relevance.js
 * Prereq: data/historical_embeddings.json (run generate-embeddings.js first)
 *
 * DESIGN DECISION — pure semantic, no theme/category metadata:
 *   SIH 2026 theme labels are severely misassigned in the source dataset.
 *   E.g. "Space Technology" contains a dementia-care mobile app; "MedTech" has a
 *   land-records digitization system; "Blockchain" has Khadi spinning equipment.
 *   Theme metadata is unreliable for individual PSs and contributes noise, not
 *   signal. Domain relevance is derived purely from the 384-dim embedding of
 *   (title + description) vs. 7 domain prototype texts.
 *   See DECISIONS.md for the full rationale.
 */
"use strict";

const fs   = require("fs");
const path = require("path");

const ROOT     = path.resolve(__dirname, "..");
const HIST_IN  = path.join(ROOT, "data", "historical_embeddings.json");
const OUT_FILE = path.join(ROOT, "data", "domain_relevance_2026.json");

const DOMAINS = [
  {
    key: "AI/ML",
    label: "AI / ML",
    prototype:
      "machine learning artificial intelligence deep learning neural network " +
      "computer vision natural language processing NLP large language model " +
      "predictive analytics classification object detection image recognition " +
      "anomaly detection recommendation system generative AI model training " +
      "inference feature extraction data-driven automated decision making " +
      "convolutional recurrent transformer architecture AI-powered intelligent " +
      "cognitive computing pattern recognition reinforcement learning",
  },
  {
    key: "Web",
    label: "Web Development",
    prototype:
      "web application web portal online platform digital platform cloud-based " +
      "REST API microservices frontend backend dashboard database management " +
      "full-stack development user interface browser-based server-side application " +
      "progressive web app SaaS software as a service API integration web service " +
      "responsive design authentication authorization role-based access control " +
      "real-time data visualization reporting platform",
  },
  {
    key: "Hardware",
    label: "Hardware / IoT",
    prototype:
      "embedded system sensor IoT internet of things microcontroller " +
      "drone unmanned aerial vehicle UAV robotics electronics hardware device " +
      "circuit board PCB firmware real-time control FPGA signal processing " +
      "actuator motor mechatronics autonomous vehicle equipment manufacturing " +
      "physical prototype wearable sensor network edge computing radar sonar " +
      "satellite payload low-power wireless communication",
  },
  {
    key: "Blockchain",
    label: "Blockchain / Security",
    prototype:
      "blockchain distributed ledger smart contract cryptocurrency " +
      "cybersecurity network security threat detection cryptography " +
      "digital forensics dark web decentralized identity access control " +
      "digital signature quantum cryptography data privacy secure communication " +
      "intrusion detection malware ransomware vulnerability assessment " +
      "cyber risk penetration testing security audit forensic analysis " +
      "immutable ledger tokenization wallet address anti-money laundering",
  },
  {
    key: "GIS",
    label: "GIS / Geospatial",
    prototype:
      "GIS geographic information system geospatial mapping satellite imagery " +
      "remote sensing spatial data land record cadastral urban planning " +
      "drone survey terrain analysis GPS coordinates location intelligence " +
      "cartography topographic map digital elevation model cadastre " +
      "land use land cover change detection earth observation multispectral " +
      "LiDAR point cloud spatial analysis geographic database",
  },
  {
    key: "Biotech",
    label: "Biotech / HealthTech",
    prototype:
      "biotechnology genomics molecular biology biomedical bioinformatics " +
      "healthcare medical patient clinical diagnosis disease detection " +
      "health monitoring physiological data mental health telemedicine " +
      "electronic health record drug discovery genomic sequencing " +
      "medical imaging pathology diagnostics rehabilitation assistive technology " +
      "wearable health device patient management hospital information system " +
      "epidemiology public health veterinary livestock animal health",
  },
  {
    key: "Mobile",
    label: "Mobile Apps",
    prototype:
      "mobile application Android iOS smartphone app Flutter React Native " +
      "cross-platform mobile development mobile-first touch interface " +
      "location-based service offline capability push notification " +
      "augmented reality AR mobile camera QR code NFC mobile payment " +
      "user experience UX mobile UI lightweight app field worker application " +
      "mobile data collection rural connectivity low-bandwidth mobile",
  },
];

function cosineSim(a, b) {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

async function main() {
  console.log("=== SIH Copilot — Domain Relevance Pipeline ===\n");

  if (!fs.existsSync(HIST_IN)) {
    throw new Error(HIST_IN + " not found. Run generate-embeddings.js first.");
  }
  console.log("Loading historical_embeddings.json...");
  const histData = JSON.parse(fs.readFileSync(HIST_IN, "utf8"));
  const records2026 = histData.records.filter((r) => r.year === 2026);
  console.log("  Found " + records2026.length + " SIH 2026 embeddings.");

  console.log("\nLoading embedding model (Xenova/all-MiniLM-L6-v2)...");
  const { pipeline } = await import("@xenova/transformers");
  const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  console.log("  Model ready.\n");

  console.log("Embedding domain prototypes...");
  const domainEmbeddings = [];
  for (const domain of DOMAINS) {
    const output = await embedder(domain.prototype, { pooling: "mean", normalize: true });
    domainEmbeddings.push(Array.from(output.data));
    console.log("  [done] " + domain.key);
  }

  console.log("\nComputing domain relevance for " + records2026.length + " PSs...");
  const results = [];
  for (const rec of records2026) {
    const psEmb = rec.embedding;
    const domainRel = {};
    DOMAINS.forEach((domain, i) => {
      domainRel[domain.key] = parseFloat(cosineSim(psEmb, domainEmbeddings[i]).toFixed(4));
    });
    results.push({ psId: rec.psId, year: 2026, title: rec.title, domainRel });
  }
  results.sort((a, b) => String(a.psId).localeCompare(String(b.psId)));

  // Spot-checks
  const checks = [
    { label: "Top 5 AI/ML", key: "AI/ML" },
    { label: "Top 5 GIS",   key: "GIS" },
    { label: "Top 5 Blockchain/Security", key: "Blockchain" },
    { label: "Top 5 Biotech/HealthTech",  key: "Biotech" },
    { label: "Top 5 Hardware/IoT",        key: "Hardware" },
  ];
  for (const chk of checks) {
    console.log("\n--- " + chk.label + " ---");
    [...results]
      .sort((a, b) => b.domainRel[chk.key] - a.domainRel[chk.key])
      .slice(0, 5)
      .forEach((r) => {
        const s = DOMAINS.map((d) => d.key + "=" + r.domainRel[d.key]).join("  ");
        console.log("  " + r.psId + ": " + r.title.slice(0, 70));
        console.log("    " + s);
      });
  }

  const out = {
    version:             new Date().toISOString().slice(0, 10),
    model:               "Xenova/all-MiniLM-L6-v2",
    softmax_temperature: 0.08,
    domains:             DOMAINS.map((d) => d.key),
    domainLabels:        DOMAINS.map((d) => d.label),
    totalRecords:        results.length,
    records:             results,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out), "utf8");
  const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
  console.log("\nOutput: " + OUT_FILE + " (" + kb + " KB)");
  console.log("Done. Next: node scripts/build.js");
}

main().catch((err) => { console.error("\nFATAL:", err); process.exit(1); });
