import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { buildInlineBootstrapSource } from "./src/security/trustedTypes.js";

const currentDir = dirname(fileURLToPath(import.meta.url));

function stripModulePreloads(html: string): string {
  return html.replace(/<link\b[^>]*rel=["']modulepreload["'][^>]*>\s*/gi, "");
}

function inlineStrictDynamicEntryScript(html: string): string {
  const withoutPreloads = stripModulePreloads(html);
  const entryScriptMatch =
    /<script\b[^>]*type=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/i.exec(
      withoutPreloads
    );
  if (!entryScriptMatch || !entryScriptMatch[1]) {
    return withoutPreloads;
  }
  const entrySrc = entryScriptMatch[1];
  const bootstrapTag = `<script>${buildInlineBootstrapSource(entrySrc)}</script>`;
  return withoutPreloads.replace(entryScriptMatch[0], bootstrapTag);
}

function toulminStrictDynamicBootstrapPlugin(): Plugin {
  return {
    name: "toulmin-strict-dynamic-bootstrap",
    enforce: "post",
    transformIndexHtml(html, ctx) {
      // Only rewrite emitted production/spike build bundles (dev server keeps native Vite HMR script)
      if (!ctx.bundle) {
        return html;
      }
      return inlineStrictDynamicEntryScript(html);
    },
  };
}

export default defineConfig(({ mode }) => {
  const includeSpike = mode === "spike" || process.env["TOULMIN_BUILD_SPIKE"] === "1";

  return {
    root: currentDir,
    plugins: [toulminStrictDynamicBootstrapPlugin()],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      target: "es2022",
      modulePreload: false,
      rollupOptions: {
        input: includeSpike
          ? {
              index: resolve(currentDir, "index.html"),
              spike: resolve(currentDir, "spike.html"),
            }
          : {
              index: resolve(currentDir, "index.html"),
            },
      },
    },
  };
});
