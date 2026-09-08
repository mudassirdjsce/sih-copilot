const esbuild = require("esbuild");
const fs      = require("fs");
const path    = require("path");

const ROOT   = path.resolve(__dirname, "..");
const NM     = path.join(__dirname, "node_modules");

// Service worker
const SW_SRC = path.join(ROOT, "extension", "background", "service-worker-src.js");
const SW_OUT = path.join(ROOT, "extension", "background", "service-worker.js");

// Offscreen
const OFF_SRC = path.join(ROOT, "extension", "offscreen", "offscreen-src.js");
const OFF_OUT = path.join(ROOT, "extension", "offscreen", "offscreen.js");

console.log("Building Service Worker...");
esbuild.buildSync({
  entryPoints: [SW_SRC],
  bundle:      true,
  outfile:     SW_OUT,
  format:      "esm",
  platform:    "browser",
  target:      ["chrome116"],
  minify:      false,
  external:    ["chrome"],
});
console.log("  -> " + SW_OUT + " (" + (fs.statSync(SW_OUT).size / 1024).toFixed(1) + " KB)");

console.log("Building Offscreen Document...");
esbuild.buildSync({
  entryPoints: [OFF_SRC],
  bundle:      true,
  outfile:     OFF_OUT,
  format:      "esm",
  platform:    "browser",
  target:      ["chrome116"],
  minify:      false,
  external:    ["chrome"],
  nodePaths:   [NM],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});
console.log("  -> " + OFF_OUT + " (" + (fs.statSync(OFF_OUT).size / 1024).toFixed(1) + " KB)");

// Sync historical embeddings JSON into extension/data/
// The generate-embeddings.js script writes to data/ (project root).
// The extension serves the file from extension/data/ via web_accessible_resources.
// Always copy so the two never silently diverge.
const HIST_SRC = path.join(ROOT, "data",      "historical_embeddings.json");
const HIST_DST = path.join(ROOT, "extension", "data", "historical_embeddings.json");
if (fs.existsSync(HIST_SRC)) {
  fs.mkdirSync(path.dirname(HIST_DST), { recursive: true });
  fs.copyFileSync(HIST_SRC, HIST_DST);
  console.log("Synced historical_embeddings.json -> extension/data/ (" +
    (fs.statSync(HIST_DST).size / 1024).toFixed(1) + " KB)");
} else {
  console.warn("WARNING: data/historical_embeddings.json not found." +
    " Run: node scripts/generate-embeddings.js");
}

const DOM_SRC = path.join(ROOT, "data",      "domain_relevance_2026.json");
const DOM_DST = path.join(ROOT, "extension", "data", "domain_relevance_2026.json");
if (fs.existsSync(DOM_SRC)) {
  fs.mkdirSync(path.dirname(DOM_DST), { recursive: true });
  fs.copyFileSync(DOM_SRC, DOM_DST);
  console.log("Synced domain_relevance_2026.json -> extension/data/ (" +
    (fs.statSync(DOM_DST).size / 1024).toFixed(1) + " KB)");
} else {
  console.warn("WARNING: data/domain_relevance_2026.json not found." +
    " Run: cd scripts && node generate-domain-relevance.js");
}