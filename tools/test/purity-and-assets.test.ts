import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  generalCategory,
  getUnicode151BinBytes,
  getWordlistEnSet,
  getWordlistEnText,
  isInWordlistEn,
  parseUnicode151Bin,
  sha256hex,
  simpleLowerCodePoint
} from "../../packages/core-l0/src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

describe("Tier A bundled asset parity & ESLint boundary guardrails", () => {
  it("unicode_15_1.bin on disk is byte-identical to embedded table and parses accurately", () => {
    const diskBytes = readFileSync(
      resolve(REPO_ROOT, "packages", "core-l0", "unicode_15_1.bin")
    );
    const embedded = getUnicode151BinBytes();

    expect(embedded.length).toBe(diskBytes.length);
    expect(Buffer.from(embedded).equals(diskBytes)).toBe(true);

    const parsed = parseUnicode151Bin(new Uint8Array(diskBytes));
    expect(parsed.bmpCategories["A".charCodeAt(0)]).toBe(1); // Lu
    expect(generalCategory(0x1c89)).toBe("Cn");
    expect(generalCategory(0x2ebf0)).toBe("Lo");
    expect(simpleLowerCodePoint(0x0041)).toBe(0x0061);

    const nodeSha = createHash("sha256").update("a\ufffdb", "utf8").digest("hex");
    expect(sha256hex("a" + String.fromCharCode(0xd800) + "b")).toBe(nodeSha);
  });

  it("wordlist_en.txt on disk is 50,000 sorted words and byte-identical to embedded TS module", () => {
    const diskText = readFileSync(
      resolve(REPO_ROOT, "packages", "core-l0", "wordlist_en.txt"),
      "utf8"
    );
    const embeddedText = getWordlistEnText();

    expect(embeddedText).toBe(diskText);

    const lines = diskText.split("\n").filter((w) => w.length > 0);
    expect(lines).toHaveLength(50_000);

    const set = getWordlistEnSet();
    expect(set.size).toBe(50_000);
    expect(isInWordlistEn("mortality")).toBe(true);
    expect(isInWordlistEn("treatment")).toBe(true);
    expect(isInWordlistEn("long-term")).toBe(true);
    expect(isInWordlistEn("longterm")).toBe(false);
  });

  it("packages/core-l0/src has zero forbidden regex classes or nested quantifiers", async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const coreFiles = collectTsFiles(resolve(REPO_ROOT, "packages", "core-l0", "src"));
    expect(coreFiles.length).toBeGreaterThanOrEqual(2);
    const results = await eslint.lintFiles(coreFiles);
    const errorCount = results.reduce((sum, r) => sum + r.errorCount, 0);
    expect(errorCount).toBe(0);

    // Extra AST static check ensuring zero RegularExpressionLiteral or RegExp constructor usage in core-l0/src
    for (const file of coreFiles) {
      const src = readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
      const regexHits: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isRegularExpressionLiteral(node)) {
          regexHits.push(node.getText(sourceFile));
        } else if (
          (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "RegExp"
        ) {
          regexHits.push(node.getText(sourceFile));
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      expect(regexHits, `${file} contains forbidden regex constructs`).toEqual([]);
    }
  });

  it("ESLint rejects purity violations in packages/core-l0 and firebase/ai outside packages/firebase-client", async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const coreProbe = resolve(REPO_ROOT, "packages", "core-l0", "src", "__probe__.ts");

    const forbiddenCoreSnippets: Array<{ label: string; code: string }> = [
      { label: "firebase/ai import", code: 'import { getAI } from "firebase/ai"; export const x = getAI;' },
      { label: "node:fs import", code: 'import { readFileSync } from "node:fs"; export const x = readFileSync;' },
      { label: "bare fs import", code: 'import fs from "fs"; export const x = fs;' },
      { label: "node:crypto import", code: 'import { createHash } from "node:crypto"; export const x = createHash;' },
      { label: "node:http import", code: 'import http from "node:http"; export const x = http;' },
      { label: "fetch global", code: 'export async function f() { return fetch("https://example.com"); }' },
      { label: "window global", code: 'export const x = window.location;' },
      { label: "document global", code: 'export const x = document.body;' },
      { label: "setTimeout global", code: 'export const x = setTimeout(() => {}, 1);' },
      { label: "Math.random()", code: 'export const x = Math.random();' },
      { label: "String.prototype.normalize()", code: 'export const x = "a".normalize("NFC");' },
      { label: "String.prototype.toLowerCase()", code: 'export const x = "A".toLowerCase();' },
      { label: "Date global", code: 'export const x = Date.now();' },
      { label: "globalThis.fetch", code: 'export const x = globalThis.fetch("https://example.com");' },
      { label: "globalThis.Math.random", code: 'export const x = globalThis.Math.random();' },
      { label: "implicit \\w regex", code: 'export const r = /\\w+/;' },
      { label: "implicit \\s regex", code: 'export const r = new RegExp("\\\\s+");' },
      { label: "nested unbounded regex", code: 'export const r = /(a+)+/;' },
      { label: "overlapping alternatives regex", code: 'export const r = /(a|aa)+/;' },
      { label: "overlapping prefix alternatives regex", code: 'export const r = /(?:ab|abc)+/;' }
    ];

    for (const snippet of forbiddenCoreSnippets) {
      const [res] = await eslint.lintText(snippet.code, { filePath: coreProbe });
      expect(res?.errorCount ?? 0, `Expected ESLint error for: ${snippet.label}`).toBeGreaterThan(0);
    }

    // Disjoint alternatives and bounded inner repetitions are permitted
    const allowedCoreSnippets = [
      'export const r = /(?:foo|bar)+/;',
      'export const r = /(?:[a-z]{1,40})+/;'
    ];
    for (const code of allowedCoreSnippets) {
      const [res] = await eslint.lintText(code, { filePath: coreProbe });
      expect(res?.errorCount ?? 0).toBe(0);
    }

    // firebase/ai forbidden outside packages/firebase-client
    const webProbe = resolve(REPO_ROOT, "apps", "web", "src", "__probe__.ts");
    const [webRes] = await eslint.lintText(
      'import { getAI } from "firebase/ai"; export const x = getAI;',
      { filePath: webProbe }
    );
    expect(webRes?.errorCount ?? 0).toBeGreaterThan(0);

    // firebase/ai allowed inside packages/firebase-client
    const fbClientProbe = resolve(REPO_ROOT, "packages", "firebase-client", "src", "__probe__.ts");
    const [fbRes] = await eslint.lintText(
      'import { getAI } from "firebase/ai"; export const x = getAI;',
      { filePath: fbClientProbe }
    );
    const restrictedErrors = (fbRes?.messages ?? []).filter(
      (m) => m.ruleId === "no-restricted-imports"
    );
    expect(restrictedErrors.length).toBe(0);
  });
});
