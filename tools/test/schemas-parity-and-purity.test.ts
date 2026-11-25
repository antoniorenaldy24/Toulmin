import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type {
  BibStatus as CoreBibStatus,
  CanonicalSectionLabel as CoreCanonicalSectionLabel,
  EvidenceSourceKind as CoreEvidenceSourceKind,
  MarkerKind as CoreMarkerKind,
  MetricClass as CoreMetricClass,
  PComparator as CorePComparator,
  QuantTuple as CoreQuantTuple,
  TextRange as CoreTextRange,
  TupleSource as CoreTupleSource,
} from "../../packages/core-l0/src/index.js";
import type {
  BibStatus as SchemaBibStatus,
  CanonicalSectionLabel as SchemaCanonicalSectionLabel,
  EvidenceSourceKind as SchemaEvidenceSourceKind,
  MarkerKind as SchemaMarkerKind,
  MetricClass as SchemaMetricClass,
  PComparator as SchemaPComparator,
  QuantTuple as SchemaQuantTuple,
  TextRange as SchemaTextRange,
  TupleSource as SchemaTupleSource,
} from "../../packages/schemas/src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

type AssertExactEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const _bibStatusParity: AssertExactEqual<CoreBibStatus, SchemaBibStatus> = true;
const _markerKindParity: AssertExactEqual<CoreMarkerKind, SchemaMarkerKind> = true;
const _evidenceKindParity: AssertExactEqual<CoreEvidenceSourceKind, SchemaEvidenceSourceKind> = true;
const _metricClassParity: AssertExactEqual<CoreMetricClass, SchemaMetricClass> = true;
const _pComparatorParity: AssertExactEqual<CorePComparator, SchemaPComparator> = true;
const _tupleSourceParity: AssertExactEqual<CoreTupleSource, SchemaTupleSource> = true;
const _textRangeParity: AssertExactEqual<CoreTextRange, SchemaTextRange> = true;
const _quantTupleParity: AssertExactEqual<CoreQuantTuple, SchemaQuantTuple> = true;
const _sectionLabelParity: AssertExactEqual<CoreCanonicalSectionLabel, SchemaCanonicalSectionLabel> = true;

describe("@toulmin/schemas purity & @toulmin/core-l0 type parity", () => {
  it("matches @toulmin/core-l0 domain types bidirectionally with zero drift", () => {
    expect(_bibStatusParity).toBe(true);
    expect(_markerKindParity).toBe(true);
    expect(_evidenceKindParity).toBe(true);
    expect(_metricClassParity).toBe(true);
    expect(_pComparatorParity).toBe(true);
    expect(_tupleSourceParity).toBe(true);
    expect(_textRangeParity).toBe(true);
    expect(_quantTupleParity).toBe(true);
    expect(_sectionLabelParity).toBe(true);
  });

  it("enforces 100% purity in packages/schemas/src with zero forbidden imports, globals, or regexes", async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const srcDir = resolve(REPO_ROOT, "packages", "schemas", "src");
    const files = readdirSync(srcDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => resolve(srcDir, f));
    expect(files.length).toBeGreaterThanOrEqual(5);

    const results = await eslint.lintFiles(files);
    const errorCount = results.reduce((sum, r) => sum + r.errorCount, 0);
    expect(errorCount).toBe(0);

    // Verify every import in packages/schemas/src is strictly local (relative .js or .schema.json; zero firebase/ai, node:*, or @toulmin/core-l0)
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const importSpecifiers: string[] = [];
      sf.forEachChild((node) => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          importSpecifiers.push(node.moduleSpecifier.text);
        }
      });
      for (const spec of importSpecifiers) {
        expect(
          spec.startsWith("./") || (spec.startsWith("../") && spec.endsWith(".schema.json")),
          `Unexpected non-local import "${spec}" in ${file}`
        ).toBe(true);
      }
    }

    // Programmatic ESLint purity probe
    const probeFile = resolve(srcDir, "__probe__.ts");
    const forbidden = [
      'import { getAI } from "firebase/ai"; export const x = getAI;',
      'import { readFileSync } from "node:fs"; export const x = readFileSync;',
      'export const x = fetch("https://example.com");',
      'export const x = window.location;',
      'export const x = Date.now();',
      'export const x = Math.random();',
      'export const r = /\\w+/;',
    ];
    for (const code of forbidden) {
      const [res] = await eslint.lintText(code, { filePath: probeFile });
      expect(res?.errorCount ?? 0).toBeGreaterThan(0);
    }
  });
});
