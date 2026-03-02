import { build } from "esbuild";
import { readFileSync } from "node:fs";

const templateHtml = readFileSync(
  "src/reporting/html-report/template.html",
  "utf-8",
);

await build({
  entryPoints: ["dist/index.js"],
  bundle: true,
  minify: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist/index.min.js",
  banner: { js: "#!/usr/bin/env node" },
  external: ["@azure/identity", "azure-devops-node-api", "picomatch", "commander"],
  define: {
    __HTML_TEMPLATE__: JSON.stringify(templateHtml),
  },
});
