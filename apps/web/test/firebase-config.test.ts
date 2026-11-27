import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";
import { describe, expect, it } from "vitest";
import { buildInlineBootstrapSource } from "../src/security/trustedTypes.js";

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(WEB_ROOT, "..", "..");

const EXACT_SPEC_PROD_CSP =
  "default-src 'self'; script-src 'sha256-BOOTSTRAP_HASH' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.gstatic.com https://www.google.com; connect-src 'self' https://firebasevertexai.googleapis.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://content-firebaseappcheck.googleapis.com https://firebaseremoteconfig.googleapis.com https://firebaseremoteconfigrealtime.googleapis.com https://firebaseinstallations.googleapis.com https://firebasestorage.googleapis.com https://us-central1-toulmin-prod.cloudfunctions.net https://www.google.com/recaptcha/; frame-src 'self' blob: https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types default toulmin-html toulmin-worker toulmin-loader";

function readJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, relPath), "utf8")) as T;
}

describe("Root Firebase Hosting, CSP Parity, Codebase Exclusion & TTL Config (05 §2, §6.3, AC-SEC-04/06/13)", () => {
  it("enforces exact production Hosting CSP, headers, spike.html ignore, and staging codebase separation", () => {
    const prod = readJson<{
      hosting: {
        site: string;
        public: string;
        ignore: string[];
        headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
        rewrites: Array<{ source: string; destination: string }>;
      };
      firestore: { rules: string; indexes: string };
      storage: { rules: string };
      functions: Array<{ codebase: string; source: string; runtime: string; ignore: string[] }>;
      emulators: Record<string, unknown>;
    }>("firebase.json");

    expect(prod.hosting.site).toBe("toulmin");
    expect(prod.hosting.public).toBe("apps/web/dist");
    expect(prod.hosting.ignore).toEqual(expect.arrayContaining(["spike.html", "**/spike-*"]));
    expect(prod.hosting.rewrites).toEqual([{ source: "**", destination: "/index.html" }]);
    expect(prod.firestore).toEqual({
      rules: "firestore.rules",
      indexes: "firestore.indexes.json",
    });
    expect(prod.storage).toEqual({ rules: "storage.rules" });
    expect(prod.functions).toHaveLength(1);
    expect(prod.functions[0]?.codebase).toBe("default");
    expect(prod.functions[0]?.runtime).toBe("nodejs22");
    expect(prod.functions[0]?.ignore).toContain("src/staging/**");

    const hdrs = new Map(
      (prod.hosting.headers[0]?.headers ?? []).map((h) => [h.key, h.value])
    );
    const prodCsp = hdrs.get("Content-Security-Policy") ?? "";
    expect(prodCsp).toBe(EXACT_SPEC_PROD_CSP);
    expect(hdrs.has("Reporting-Endpoints")).toBe(false);
    expect(hdrs.get("Referrer-Policy")).toBe("no-referrer");
    expect(hdrs.get("X-Content-Type-Options")).toBe("nosniff");
    expect(hdrs.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), interest-cohort=()"
    );
    expect(hdrs.get("Cross-Origin-Opener-Policy")).toBe("same-origin");

    const rawProd = readFileSync(resolve(REPO_ROOT, "firebase.json"), "utf8");
    expect(rawProd).not.toContain("cspReportStaging");

    // Preview / staging parity (05 §2.4, 06 §5.2, AC-SEC-13)
    const preview = readJson<{
      hosting: {
        site: string;
        headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
      };
      functions?: Array<{ codebase: string; source: string; runtime: string; ignore: string[] }>;
    }>("firebase.preview.json");
    expect(preview.hosting.site).toBe("toulmin-staging");
    const previewHdrs = new Map(
      (preview.hosting.headers[0]?.headers ?? []).map((h) => [h.key, h.value])
    );
    const previewCsp = previewHdrs.get("Content-Security-Policy") ?? "";
    expect(previewCsp).toBe(`${prodCsp}; report-to csp`);
    expect(previewHdrs.get("Reporting-Endpoints")).toBe(
      'csp="https://us-central1-toulmin-staging.cloudfunctions.net/cspReportStaging"'
    );
    const codebases = (preview.functions ?? []).map((f) => f.codebase).sort();
    expect(codebases).toEqual(["default", "staging"]);
  });

  it("declares all 5 Firestore TTL fieldOverrides in firestore.indexes.json (05 §6.3, AC-SEC-06)", () => {
    const indexes = readJson<{
      indexes: unknown[];
      fieldOverrides: Array<{
        collectionGroup: string;
        fieldPath: string;
        ttl?: boolean;
        indexes: unknown[];
      }>;
    }>("firestore.indexes.json");

    expect(indexes.indexes).toEqual([]);
    const ttlGroups = indexes.fieldOverrides
      .filter((f) => f.fieldPath === "expireAt" && f.ttl === true)
      .map((f) => f.collectionGroup)
      .sort();
    expect(ttlGroups).toEqual(["leases", "netCounters", "quota", "refmeta", "shards"]);
    expect(indexes.fieldOverrides.some((f) => f.collectionGroup === "judgeCodes")).toBe(false);
  });

  it("produces strict-dynamic Vite production build with inline bootstrap, zero external script tags, and zero spike.html", async () => {
    const boot = buildInlineBootstrapSource("/assets/index-test123.js");
    expect(boot).toContain("__toulminTrustedPolicies");
    expect(boot).not.toContain("eval(");

    const tmpOutDir = mkdtempSync(join(tmpdir(), "toulmin-web-dist-"));
    try {
      await viteBuild({
        root: WEB_ROOT,
        configFile: resolve(WEB_ROOT, "vite.config.ts"),
        logLevel: "silent",
        build: {
          outDir: tmpOutDir,
          emptyOutDir: true,
        },
      });
      const builtIndex = join(tmpOutDir, "index.html");
      const builtSpike = join(tmpOutDir, "spike.html");
      expect(existsSync(builtIndex)).toBe(true);
      expect(existsSync(builtSpike)).toBe(false);

      const html = readFileSync(builtIndex, "utf8");
      expect(html).not.toMatch(/<script\b[^>]*\bsrc=/i);
      expect(html).not.toMatch(/<link\b[^>]*rel=["']modulepreload["']/i);
      expect(html).toContain("__toulminTrustedPolicies");
      expect(html).toContain("toulmin-loader");
    } finally {
      rmSync(tmpOutDir, { recursive: true, force: true });
    }
  });
});
