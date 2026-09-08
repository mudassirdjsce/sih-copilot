/**
 * build-sw.js -- SIH Copilot Phase 2 build script
 *
 * Run from repo root:  node scripts/build-sw.js
 *
 * WHAT this does:
 *   Bundles extension/background/service-worker-src.js (ESM) with esbuild
 *   -> extension/background/service-worker.js  (~1.2 MB, single file)
 *
 * WHAT it does NOT bundle (fetched at runtime and cached by browser):
 *   - ONNX Runtime WASM files (~13 MB) -- fetched from jsDelivr CDN
 *   - Model weights for all-MiniLM-L6-v2 (~22 MB) -- from HuggingFace Hub
 *
 * WHY not bundle them:
 *   Chrome Web Store has a 10 MB extension package limit.  The WASM alone
 *   is 13 MB.  Fetching at runtime is the standard approach; the browser
 *   caches both the WASM and model weights automatically after the first use.
 *
 * WASM LOADING: onnxruntime-web uses fetch() to download the .wasm binary,
 *   then WebAssembly.instantiate() to compile it.  Neither is blocked by
 *   MV3 CSP -- only eval() is restricted.  The 'wasm-unsafe-eval' CSP entry
 *   covers the WASM instantiation itself.
 */

const esbuild = require("esbuild");
const fs      = require("fs");
const path    = require("path");

const ROOT   = path.resolve(__dirname, "..");
const NM     = path.join(__dirname, "node_modules");
const SW_SRC = path.join(ROOT, "extension", "background", "service-worker-src.js");
const SW_OUT = path.join(ROOT, "extension", "background", "service-worker.js");

console.log("Building service worker bundle...");
const t0 = Date.now();

esbuild.buildSync({
  entryPoints: [SW_SRC],
  bundle:      true,
  outfile:     SW_OUT,
  format:      "esm",
  platform:    "browser",
  target:      ["chrome116"],
  minify:      false,
  sourcemap:   false,
  external:    ["chrome"],
  nodePaths:   [NM],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

const swKB = (fs.statSync(SW_OUT).size / 1024).toFixed(1);
console.log("  -> " + SW_OUT);
console.log("  Bundle size: " + swKB + " KB  (" + (Date.now() - t0) + " ms)");

// Size report
function dirSizeKB(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const f of fs.readdirSync(dir)) {
    try {
      const stat = fs.statSync(path.join(dir, f));
      total += stat.isFile() ? stat.size : 0;
    } catch {}
  }
  return total / 1024;
}

const extKB = dirSizeKB(path.join(ROOT, "extension"));

console.log("\n=== Build summary ===");
console.log("JS bundle shipped with extension:          " + swKB + " KB");
console.log("WASM runtime (fetched + cached at runtime): ~13 MB (jsDelivr CDN)");
console.log("Model weights (fetched + cached at runtime): ~22 MB (HuggingFace Hub)");
console.log("Total extension package size (approx):     ~" + (extKB/1024).toFixed(1) + " MB (excl WASM/model)");