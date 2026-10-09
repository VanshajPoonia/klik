// OPS-3: bundles the upload queue's service worker to public/upload-sw.js.
//
// A service worker has to be one plain script at a fixed URL, which Next does
// not build, so this does, before `next build` and `next dev`. The output is
// generated and ignored by git: lib/upload-queue/worker.ts is the source.
import { build } from "esbuild";

await build({
  entryPoints: ["lib/upload-queue/worker.ts"],
  outfile: "public/upload-sw.js",
  bundle: true,
  format: "iife",
  target: ["chrome100", "safari15", "firefox110"],
  minify: true,
  legalComments: "none",
  banner: { js: "/* Klik upload queue worker. Generated from lib/upload-queue/worker.ts. */" },
  logLevel: "warning",
});
