import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  buildInlineBootstrapSource,
  createTrustedWorkerScriptUrl,
  registerTrustedTypesPolicies,
  validateRecaptchaScriptUrl,
  validateSameOriginAssetUrl,
  type TrustedTypesPolicyRules,
} from "../src/security/trustedTypes.js";

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(WEB_ROOT, "..", "..");

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("Trusted Types policies & apps/web module security boundaries (00 §7.2/7.4, 05 §2.3)", () => {
  it("validates all 4 Trusted Types policy behaviors including dot-segment traversal rejection", () => {
    const registered: Record<string, TrustedTypesPolicyRules> = {};
    registerTrustedTypesPolicies(
      {
        createPolicy(name, rules) {
          registered[name] = rules;
          return rules;
        },
      },
      "https://toulmin.web.app"
    );

    expect(Object.keys(registered).sort()).toEqual([
      "default",
      "toulmin-html",
      "toulmin-loader",
      "toulmin-worker",
    ]);

    // default policy: reCAPTCHA HTTPS URLs only, dot segments resolved
    expect(validateRecaptchaScriptUrl("https://www.google.com/recaptcha/enterprise.js")).toBe(
      "https://www.google.com/recaptcha/enterprise.js"
    );
    expect(validateRecaptchaScriptUrl("https://www.gstatic.com/recaptcha/releases/abc.js")).toBe(
      "https://www.gstatic.com/recaptcha/releases/abc.js"
    );
    expect(() =>
      validateRecaptchaScriptUrl("https://www.google.com/recaptcha/../evil.js")
    ).toThrow(TypeError);
    expect(() =>
      validateRecaptchaScriptUrl("http://www.google.com/recaptcha/enterprise.js")
    ).toThrow(TypeError);
    expect(() =>
      validateRecaptchaScriptUrl("https://user:pass@www.google.com/recaptcha/enterprise.js")
    ).toThrow(TypeError);
    expect(() => validateRecaptchaScriptUrl("https://evil.example/recaptcha/a.js")).toThrow(
      TypeError
    );
    expect(() => registered["default"]?.createHTML?.("<p>x</p>")).toThrow(TypeError);
    expect(() => registered["default"]?.createScript?.("alert(1)")).toThrow(TypeError);

    // toulmin-worker / toulmin-loader: same-origin /assets/[A-Za-z0-9._-]+\.js$ only
    expect(
      validateSameOriginAssetUrl("/assets/index-a1B2_c3.js", "https://toulmin.web.app")
    ).toBe("https://toulmin.web.app/assets/index-a1B2_c3.js");
    expect(() =>
      validateSameOriginAssetUrl("/assets/../other.js", "https://toulmin.web.app")
    ).toThrow(TypeError);
    expect(() =>
      validateSameOriginAssetUrl("https://evil.example/assets/x.js", "https://toulmin.web.app")
    ).toThrow(TypeError);
    expect(() =>
      validateSameOriginAssetUrl("/assets/nested/x.js", "https://toulmin.web.app")
    ).toThrow(TypeError);
    expect(() => registered["toulmin-worker"]?.createHTML?.("<b>x</b>")).toThrow(TypeError);
    expect(() => registered["toulmin-loader"]?.createScript?.("x")).toThrow(TypeError);

    // toulmin-html: throws when createScriptURL/createScript called
    expect(() =>
      registered["toulmin-html"]?.createScriptURL?.("/assets/index.js")
    ).toThrow(TypeError);
    expect(() => registered["toulmin-html"]?.createScript?.("1+1")).toThrow(TypeError);
  });

  it("enforces zero direct firebase/* imports, unsafe HTML sinks, debug tokens, or secrets in apps/web/src", () => {
    const files = walkTsFiles(resolve(WEB_ROOT, "src"));
    expect(files.length).toBeGreaterThan(0);

    const forbiddenImports: string[] = [];
    const forbiddenSinks: string[] = [];

    for (const file of files) {
      const code = readFileSync(file, "utf8");
      const sf = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true);

      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          const mod = node.moduleSpecifier;
          if (mod && ts.isStringLiteral(mod)) {
            const spec = mod.text;
            if (
              spec === "firebase" ||
              spec.startsWith("firebase/") ||
              spec.startsWith("@firebase/")
            ) {
              forbiddenImports.push(`${file}: ${spec}`);
            }
          }
        }
        if (ts.isPropertyAccessExpression(node)) {
          const prop = node.name.text;
          if (
            prop === "innerHTML" ||
            prop === "outerHTML" ||
            prop === "insertAdjacentHTML" ||
            prop === "srcdoc"
          ) {
            forbiddenSinks.push(`${file}: .${prop}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);

      expect(code).not.toContain("FIREBASE_APPCHECK_DEBUG_TOKEN");
      expect(code).not.toContain("APPCHECK_DEBUG_TOKEN");
      expect(code).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    }

    expect(forbiddenImports).toEqual([]);
    expect(forbiddenSinks).toEqual([]);
  });

  it("executes inline bootstrap under strict non-duplicate Trusted Types and exposes reusable policy handles", () => {
    const createdNames = new Set<string>();
    const appendedScripts: Array<{ type?: string; src?: unknown }> = [];
    const strictFactory = {
      createPolicy(name: string, rules: TrustedTypesPolicyRules) {
        if (createdNames.has(name)) {
          throw new TypeError(`Policy with name ${name} already exists`);
        }
        createdNames.add(name);
        return {
          name,
          ...rules,
        };
      },
    };

    const sandbox: Record<string, unknown> = {
      URL,
      TypeError,
      Object,
      location: { origin: "https://toulmin.web.app" },
      trustedTypes: strictFactory,
      document: {
        createElement: (tag: string) => ({ tagName: tag }),
        head: {
          appendChild: (node: { type?: string; src?: unknown }) => {
            appendedScripts.push(node);
            return node;
          },
        },
      },
    };
    sandbox["globalThis"] = sandbox;

    runInNewContext(buildInlineBootstrapSource("/assets/index-xyz987.js"), sandbox);

    expect(Array.from(createdNames).sort()).toEqual([
      "default",
      "toulmin-html",
      "toulmin-loader",
      "toulmin-worker",
    ]);
    expect(appendedScripts).toHaveLength(1);
    expect(appendedScripts[0]?.type).toBe("module");
    expect(appendedScripts[0]?.src).toBe("https://toulmin.web.app/assets/index-xyz987.js");

    // Duplicate createPolicy MUST fail under strict CSP (no 'allow-duplicates')
    expect(() => strictFactory.createPolicy("toulmin-worker", {})).toThrow(TypeError);

    // Bootstrap-exposed policy registry MUST remain accessible and frozen
    const reg = sandbox["__toulminTrustedPolicies"] as Record<string, Record<string, unknown>>;
    expect(reg).toBeDefined();
    expect(Object.isFrozen(reg)).toBe(true);
    expect(typeof reg["worker"]?.["createScriptURL"]).toBe("function");
    expect(typeof reg["html"]?.["createHTML"]).toBe("function");

    const workerCreate = reg["worker"]!["createScriptURL"] as (u: string) => string;
    expect(workerCreate("/assets/ingest.worker-abc123.js")).toBe(
      "https://toulmin.web.app/assets/ingest.worker-abc123.js"
    );
    expect(() => workerCreate("/assets/../evil.js")).toThrow(TypeError);
    expect(() => workerCreate("//evil.example/assets/worker.js")).toThrow(TypeError);

    const prevPolicies = globalThis.__toulminTrustedPolicies;
    try {
      globalThis.__toulminTrustedPolicies = reg as never;
      expect(
        createTrustedWorkerScriptUrl("/assets/pdf.worker-111.js", "https://toulmin.web.app")
      ).toBe("https://toulmin.web.app/assets/pdf.worker-111.js");
    } finally {
      if (prevPolicies === undefined) {
        delete (globalThis as { __toulminTrustedPolicies?: unknown }).__toulminTrustedPolicies;
      } else {
        globalThis.__toulminTrustedPolicies = prevPolicies;
      }
    }
  });

  it("enforces zero hardcoded user-facing textContent string literals in apps/web/src/main.ts (00 §7.4)", () => {
    const mainFile = resolve(WEB_ROOT, "src", "main.ts");
    const code = readFileSync(mainFile, "utf8");
    const sf = ts.createSourceFile(mainFile, code, ts.ScriptTarget.ES2022, true);
    const rawAssignments: string[] = [];

    const visit = (node: ts.Node): void => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        node.left.name.text === "textContent"
      ) {
        if (ts.isStringLiteralLike(node.right) || ts.isTemplateExpression(node.right)) {
          rawAssignments.push(node.getText(sf));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    expect(rawAssignments).toEqual([]);
  });

  it("does not fabricate any Phase 0 spike result files under docs/spikes/", () => {
    const spikesDir = resolve(REPO_ROOT, "docs", "spikes");
    if (existsSync(spikesDir)) {
      const entries = readdirSync(spikesDir).filter((name) => name !== ".gitkeep");
      expect(entries).toEqual([]);
    }
  });
});
