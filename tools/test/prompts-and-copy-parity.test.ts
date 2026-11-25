import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { EN_COPY } from "../../packages/copy/src/index.js";
import {
  PROMPT_TEMPLATES_P2_1,
  PROMPT_TEMPLATE_IDS,
  buildAltSourcesPrompt,
  buildB5Prompt,
  buildL2Prompt,
  buildO2Prompt,
  buildStage1Prompt,
  buildStage2Prompt,
  type PromptTemplateId,
} from "../../packages/prompts/src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".ts"))
    .map((d) => resolve(dir, d.name));
}

function extractFencedBlockAfterHeading(markdown: string, headingAnchor: string): string {
  const anchorIdx = markdown.indexOf(headingAnchor);
  if (anchorIdx === -1) {
    throw new Error(`Heading anchor not found: ${headingAnchor}`);
  }
  const fenceOpen = markdown.indexOf("```", anchorIdx);
  if (fenceOpen === -1) {
    throw new Error(`Opening fence not found after: ${headingAnchor}`);
  }
  const normalized = markdown.slice(fenceOpen).replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const closeIdx = lines.findIndex((line, idx) => idx > 0 && line.trim() === "```");
  if (closeIdx === -1) {
    throw new Error(`Closing fence not found after: ${headingAnchor}`);
  }
  return `${lines.slice(1, closeIdx).join("\n")}\n`;
}

function normalizeSpecLineForSearch(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

function collectLeafStrings(node: unknown, out: Set<string>): void {
  if (typeof node === "string") {
    out.add(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectLeafStrings(item, out);
    }
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const val of Object.values(node)) {
      collectLeafStrings(val, out);
    }
  }
}

describe("@toulmin/prompts & @toulmin/copy spec extraction, disk parity, and purity", () => {
  it("matches every packages/prompts/p2.1/*.txt file and PROMPT_TEMPLATES_P2_1 byte-for-byte with docs/spec/04", () => {
    const spec04 = normalizeSpecLineForSearch(
      readFileSync(resolve(REPO_ROOT, "docs", "spec", "04_AI_RUNTIME_PROMPTS_AND_L3.md"), "utf8")
    );

    const headingByTemplate: Readonly<Record<PromptTemplateId, string>> = {
      stage1: "### 3.2 Stage 1 prompt (`TriageV1`, `stage1.txt`)",
      stage2: "### 3.3 Stage 2 prompt (`VerdictV1`, `stage2.txt`)",
      b5: "### 3.4 B5 prompt (`B5CheckV1`, `b5.txt`)",
      o2: "### 3.5 O2/O3 extraction prompt (`O2PhysicalExtractV1`, `o2.txt`, Android)",
      l2: "#### 3.6.3 Prompt (`l2.txt`)",
      alt_sources: "- **Prompt (`alt_sources.txt`):**",
    };

    for (const id of PROMPT_TEMPLATE_IDS) {
      const specBlockRaw = extractFencedBlockAfterHeading(spec04, headingByTemplate[id]);
      // alt_sources block in 04 §4.5 is indented by 2 spaces under a bullet item
      const specTemplate =
        id === "alt_sources"
          ? specBlockRaw
              .split("\n")
              .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
              .join("\n")
          : specBlockRaw;

      const diskPath = resolve(REPO_ROOT, "packages", "prompts", "p2.1", `${id}.txt`);
      const diskText = readFileSync(diskPath, "utf8");
      expect(diskText.includes("\r"), `${id}.txt must use LF endings`).toBe(false);
      expect(diskText, `${id}.txt diverged from docs/spec/04`).toBe(specTemplate);
      expect(PROMPT_TEMPLATES_P2_1[id], `PROMPT_TEMPLATES_P2_1.${id} diverged from disk`).toBe(
        diskText
      );
    }

    // Verify builder outputs match the exact template structure when instantiated with concrete placeholders
    const s1 = buildStage1Prompt({
      hasCitation: true,
      previousSentence: "Prev.",
      sentence: "Curr.",
      words: ["Curr."],
      candidateReferences: [
        { title: "T0", year: 2020 },
        { title: "T1", year: 2021 },
        { title: "T2", year: 2022 },
        { title: "T3", year: 2023 },
        { title: "T4", year: 2024 },
      ],
    });
    expect(s1.userPrompt).toBe(
      PROMPT_TEMPLATES_P2_1.stage1
        .replace("{has_citation}", "true")
        .replace("{previous_sentence}", "Prev.")
        .replace("{sentence}", "Curr.")
        .replace("{words_numbered}", "0:Curr.")
        .replace("{title_0}", "T0")
        .replace("{year_0}", "2020")
        .replace("{title_1}", "T1")
        .replace("{year_1}", "2021")
        .replace("{title_2}", "T2")
        .replace("{year_2}", "2022")
        .replace("{title_3}", "T3")
        .replace("{year_3}", "2023")
        .replace("{title_4}", "T4")
        .replace("{year_4}", "2024")
    );

    const s2 = buildStage2Prompt({
      contextSentence: "Ctx.",
      clauseText: "Cl.",
      evidence: ["E0", "E1", "E2", "E3", "E4"],
      wordCap: 40,
    });
    expect(s2.userPrompt).toBe(
      PROMPT_TEMPLATES_P2_1.stage2
        .replace("{word_cap}", "40")
        .replace("{context_sentence}", "Ctx.")
        .replace("{clause_text}", "Cl.")
        .replace("{evidence_0}", "E0")
        .replace("{evidence_1}", "E1")
        .replace("{evidence_2}", "E2")
        .replace("{evidence_3}", "E3")
        .replace("{evidence_4}", "E4")
    );

    const b5 = buildB5Prompt({
      sectionA: "methods",
      valueA: "10",
      unitA: "%",
      windowA: "WA",
      sectionB: "results",
      valueB: "12",
      unitB: "%",
      windowB: "WB",
    });
    expect(b5.userPrompt).toBe(
      PROMPT_TEMPLATES_P2_1.b5
        .replace("{section_a}", "methods")
        .replace("{value_a}", "10")
        .replace("{unit_a}", "%")
        .replace("{window_a}", "WA")
        .replace("{section_b}", "results")
        .replace("{value_b}", "12")
        .replace("{unit_b}", "%")
        .replace("{window_b}", "WB")
    );

    const o2 = buildO2Prompt({ claimText: "C", headerText: "H", rowText: "R" });
    expect(o2.userPrompt).toBe(
      PROMPT_TEMPLATES_P2_1.o2
        .replace("{claim_text}", "C")
        .replace("{header_text}", "H")
        .replace("{row_text}", "R")
    );

    const l2 = buildL2Prompt({
      approvedClaimText: "Claim.",
      reference: {
        title: "Title",
        firstAuthor: "Author",
        year: 2022,
        venue: "Journal",
        doi: "10.1000/test",
      },
      suspicious: false,
      hasExcludedUserPdf: true,
      evidence: ["E0", "E1", "E2", "E3", "E4", "E5", "E6", "E7"],
    });
    expect(l2.userPrompt).toBe(
      PROMPT_TEMPLATES_P2_1.l2
        .replaceAll("{doi}", "10.1000/test")
        .replace("{approved_claim_text}", "Claim.")
        .replace("{title}", "Title")
        .replace("{first_author}", "Author")
        .replace("{year}", "2022")
        .replace("{venue}", "Journal")
        .replace("{suspicious}", "false")
        .replace("{pdf_note}", "EVIDENCE excludes the author's private PDF.")
        .replace("{evidence_text_0}", "E0")
        .replace("{evidence_text_1}", "E1")
        .replace("{evidence_text_2}", "E2")
        .replace("{evidence_text_3}", "E3")
        .replace("{evidence_text_4}", "E4")
        .replace("{evidence_text_5}", "E5")
        .replace("{evidence_text_6}", "E6")
        .replace("{evidence_text_7}", "E7")
    );

    const alt = buildAltSourcesPrompt({
      approvedClaimText: "Claim.",
      library: Array.from({ length: 20 }, (_, i) => ({ title: `T${i}`, year: 2000 + i })),
    });
    let expectedAlt = PROMPT_TEMPLATES_P2_1.alt_sources.replace("{approved_claim_text}", "Claim.");
    for (let i = 0; i < 20; i += 1) {
      expectedAlt = expectedAlt
        .replace(`{lib_title_${i}}`, `T${i}`)
        .replace(`{lib_year_${i}}`, String(2000 + i));
    }
    expect(alt.userPrompt).toBe(expectedAlt);
  });

  it("extracts Devpost Testing Instructions (08 §4.2.1) and all exact copy strings from docs/spec/*.md and verifies en.json", () => {
    const spec00 = normalizeSpecLineForSearch(
      readFileSync(resolve(REPO_ROOT, "docs", "spec", "00_MASTER_CONTRACT.md"), "utf8")
    );
    const spec01 = normalizeSpecLineForSearch(
      readFileSync(resolve(REPO_ROOT, "docs", "spec", "01_DATA_REDUCER_AND_METER.md"), "utf8")
    );
    const spec03 = normalizeSpecLineForSearch(
      readFileSync(resolve(REPO_ROOT, "docs", "spec", "03_L0_TIER_B_VALIDATOR_B5_INGEST.md"), "utf8")
    );
    const spec04 = normalizeSpecLineForSearch(
      readFileSync(resolve(REPO_ROOT, "docs", "spec", "04_AI_RUNTIME_PROMPTS_AND_L3.md"), "utf8")
    );
    const spec05 = normalizeSpecLineForSearch(
      readFileSync(resolve(REPO_ROOT, "docs", "spec", "05_BACKEND_SECURITY_AND_FINOPS.md"), "utf8")
    );
    const spec06 = normalizeSpecLineForSearch(
      readFileSync(resolve(REPO_ROOT, "docs", "spec", "06_CLIENTS_UI_AND_MONOREPO.md"), "utf8")
    );
    const spec08 = normalizeSpecLineForSearch(
      readFileSync(resolve(REPO_ROOT, "docs", "spec", "08_CONTEST_README_AND_VIDEO.md"), "utf8")
    );

    // 1. Full verbatim extraction of Devpost Testing Instructions (AC-STAGE1-08, 08 §4.2.1)
    const tiStart = spec08.indexOf("1. *\"Open https://toulmin.web.app/");
    const tiEnd = spec08.indexOf(" — followed by the sentence", tiStart);
    expect(tiStart).toBeGreaterThan(-1);
    expect(tiEnd).toBeGreaterThan(tiStart);
    const extractedTestingInstructions = spec08
      .slice(tiStart, tiEnd)
      .split("\n")
      .map((line) => line.replace(/^(\d+\.) \*"(.*)"\*$/, "$1 $2"))
      .join("\n");
    expect(EN_COPY.devpost.testingInstructions).toBe(extractedTestingInstructions);

    // 2. Collect all leaf strings in EN_COPY and verify extracted exact phrases from specs
    const copyLeafStrings = new Set<string>();
    collectLeafStrings(EN_COPY, copyLeafStrings);
    const allCopyJoined = Array.from(copyLeafStrings).join("\n");

    // Extract *"..."* exact copy literals from lines marked (exact) / exact across 00, 01, 03, 04, 05, 06
    const specFiles = [
      { name: "00", text: spec00 },
      { name: "01", text: spec01 },
      { name: "03", text: spec03 },
      { name: "04", text: spec04 },
      { name: "05", text: spec05 },
      { name: "06", text: spec06 },
    ];
    const extractedExactPhrases: Array<{ file: string; phrase: string }> = [];
    for (const sf of specFiles) {
      const lines = sf.text.split("\n");
      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx]!;
        const prev = idx > 0 ? lines[idx - 1]! : "";
        const prev2 = idx > 1 ? lines[idx - 2]! : "";
        const hasExactCue =
          /\bexact\b/i.test(line) ||
          prev.toLowerCase().includes("(exact") ||
          prev2.toLowerCase().includes("(exact");
        if (!hasExactCue) continue;

        let cursor = 0;
        while (cursor < line.length) {
          const open = line.indexOf('*"', cursor);
          if (open === -1) break;
          if (open > 0 && line[open - 1] === "*") {
            cursor = open + 2;
            continue;
          }
          const close = line.indexOf('"*', open + 2);
          if (close === -1) break;
          const nextOpen = line.indexOf('*"', open + 2);
          if (nextOpen !== -1 && nextOpen < close) {
            cursor = nextOpen;
            continue;
          }
          const phrase = line.slice(open + 2, close);
          // Skip meta/prose template mentions that aren't literal UI strings
          if (
            phrase.length > 0 &&
            !phrase.includes("exact") &&
            !phrase.includes("…") &&
            !phrase.startsWith("Return ONLY ")
          ) {
            extractedExactPhrases.push({ file: sf.name, phrase });
          }
          cursor = close + 2;
        }
      }
    }
    expect(extractedExactPhrases.length).toBeGreaterThanOrEqual(20);
    for (const item of extractedExactPhrases) {
      expect(
        allCopyJoined.includes(item.phrase),
        `Missing exact phrase from spec ${item.file}: "${item.phrase}"`
      ).toBe(true);
    }

    // 3. Direct cross-check of 05 §5.1–§5.6 full privacy/consent blocks and 06 §1.2–§4 exact tables
    const spec05Clean = spec05.replaceAll("**", "").replaceAll("*", "");
    expect(spec05Clean).toContain(EN_COPY.consent.standardBannerBody.split("\n")[0]!);
    expect(spec05Clean).toContain(EN_COPY.consent.standardBannerBody.split("\n")[1]!);
    expect(spec05Clean).toContain(EN_COPY.consent.confidentialNotice);
    expect(spec05Clean).toContain(EN_COPY.consent.batchSheetBody);
    expect(spec05Clean).toContain(EN_COPY.consent.localStorageNotice);
    expect(spec05Clean).toContain(EN_COPY.consent.positioningLine);

    expect(spec00).toContain(EN_COPY.product.singlePromise);
    expect(spec00).toContain(EN_COPY.document.scopeMultiFile);
    expect(spec01).toContain(EN_COPY.meter.header);
    expect(spec01).toContain(EN_COPY.clauseAria.SUPPORTED_CLOUD);
    expect(spec01).toContain(EN_COPY.clauseAria.SUPPORTED_PRINTED);
    expect(spec04).toContain(EN_COPY.environment.NOT_CHROME);
    expect(spec04).toContain(EN_COPY.environment.UNAVAILABLE_HARDWARE_OR_DISK);
    expect(spec04).toContain(EN_COPY.l3.READY_DRIFTED.banner);
    expect(spec06).toContain(EN_COPY.disclaimers.onDeviceNotVerdicts);
    expect(spec06).toContain(EN_COPY.disclaimers.unmarkedNotVerified);
    expect(spec06).toContain(EN_COPY.android.offlineReadinessMeter);
    expect(spec06).toContain(EN_COPY.ios.modelChip);
    expect(spec06).toContain(EN_COPY.ios.confidentialDisabled);
    expect(spec06).toContain(EN_COPY.ios.cloudAnsweredLine);
    expect(spec03).toContain(EN_COPY.importExport.auditProgress);
    expect(spec03).toContain(EN_COPY.importExport.exportMenu.zoteroOverwriteWarning);
  });

  it("enforces 100% ESLint and AST purity in packages/prompts/src and packages/copy/src", async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const promptFiles = collectTsFiles(resolve(REPO_ROOT, "packages", "prompts", "src"));
    const copyFiles = collectTsFiles(resolve(REPO_ROOT, "packages", "copy", "src"));
    const allFiles = [...promptFiles, ...copyFiles];
    expect(allFiles.length).toBeGreaterThanOrEqual(6);

    const lintResults = await eslint.lintFiles(allFiles);
    const errorCount = lintResults.reduce((sum, r) => sum + r.errorCount, 0);
    expect(errorCount).toBe(0);

    for (const file of promptFiles) {
      const text = readFileSync(file, "utf8");
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      sf.forEachChild((node) => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const spec = node.moduleSpecifier.text;
          expect(
            spec.startsWith("./") || spec === "@toulmin/core-l0" || spec === "@toulmin/schemas",
            `Unexpected import "${spec}" in ${file}`
          ).toBe(true);
        }
      });
    }

    for (const file of copyFiles) {
      const text = readFileSync(file, "utf8");
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      sf.forEachChild((node) => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const spec = node.moduleSpecifier.text;
          expect(
            spec.startsWith("./") ||
              spec === "@toulmin/schemas" ||
              spec === "../en.json" ||
              spec === "../tokens.json" ||
              spec === "../glyphs.json",
            `Unexpected import "${spec}" in ${file}`
          ).toBe(true);
        }
      });
    }
  });
});
