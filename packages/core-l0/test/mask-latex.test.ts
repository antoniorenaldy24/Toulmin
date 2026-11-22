import { describe, expect, it } from "vitest";
import {
  ARG_BRACE_MAX_LEN,
  CITE_COMMANDS,
  LATEX_SECTION_LEVELS,
  MASK_CHAR,
  NARRATIVE_CITE_COMMANDS,
  STRUCTURAL_COMMANDS,
  SectionTracker,
  USER_MACRO_MAX_COUNT,
  applyLatexSubstitutions,
  createEmptyImportQualityReport,
  mathText,
  normSentence,
  preMask,
  scanArgumentSequence,
  sentenceHash,
  stripLeadingSectionNumbering,
} from "../src/index.js";
import { buildBraceCloseMap } from "../src/math.js";

function medianMs(fn: () => void, trials = 7): number {
  fn();
  const times: number[] = [];
  for (let i = 0; i < trials; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

function assertMapInvariants(input: string, text: string, map: readonly number[]): void {
  expect(map).toHaveLength(text.length + 1);
  expect(map[text.length]).toBe(input.length);
  let prev = 0;
  for (const offset of map) {
    expect(offset).toBeGreaterThanOrEqual(prev);
    expect(offset).toBeLessThanOrEqual(input.length);
    prev = offset;
  }
}

describe("mathText comprehensive", () => {
  it("maps all 24 lowercase, 24 uppercase, and variant Greek commands", () => {
    const lowerCmds =
      "$\\alpha\\beta\\gamma\\delta\\epsilon\\varepsilon\\zeta\\eta\\theta\\vartheta\\iota\\kappa\\lambda\\mu\\nu\\xi\\omicron\\pi\\varpi\\rho\\varrho\\sigma\\varsigma\\tau\\upsilon\\phi\\varphi\\chi\\psi\\omega$";
    expect(mathText(lowerCmds)).toBe("αβγδεεζηθθικλμνξοππρρσςτυφφχψω");

    const upperCmds =
      "$\\Alpha\\Beta\\Gamma\\Delta\\Epsilon\\Zeta\\Eta\\Theta\\Iota\\Kappa\\Lambda\\Mu\\Nu\\Xi\\Omicron\\Pi\\Rho\\Sigma\\Tau\\Upsilon\\Phi\\Chi\\Psi\\Omega$";
    expect(mathText(upperCmds)).toBe("ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ");
  });

  it("handles nested fractions, sqrt, operators, percent, and unknown commands safely", () => {
    const expr =
      "\\begin{equation*}\\frac{\\alpha^{2}}{\\sqrt{x_{i}}} \\leq \\ge \\leqslant \\geqslant \\approx \\sim 50\\%\\end{equation*}";
    expect(mathText(expr)).toBe("(α^2)/(sqrt(x_i)) ≤ ≥ ≤ ≥ ≈ ≈ 50%");
  });

  it("handles unclosed braces cleanly without throwing or quadratically backtracking", () => {
    expect(mathText("\\frac{a}{b")).toBe("ab");
    expect(mathText("$\\frac{a}{b$")).toBe("ab");
    expect(mathText("^{2")).toBe("^2");
    expect(mathText("$\\frac{a}{b")).toBe("$ab");
  });
});

describe("sections and ImportQualityReport", () => {
  it("exposes exact LaTeX hierarchy levels and empty ImportQualityReport initializer", () => {
    expect(LATEX_SECTION_LEVELS).toEqual({
      part: 1,
      chapter: 2,
      section: 3,
      subsection: 4,
      subsubsection: 5,
      paragraph: 6,
    });
    expect(createEmptyImportQualityReport()).toEqual({
      filesRead: 0,
      filesSkipped: 0,
      skippedFiles: [],
      unresolvedInputs: [],
      macrosNotExpanded: [],
      unregisteredCommands: [],
      unknownEnvironments: [],
      tablesParsed: 0,
      mathRegions: { inline: 0, display: 0 },
      footnotes: 0,
      parseTimeouts: [],
      unresolvedKeys: [],
      possibleCitations: [],
    });
  });

  it("strips decimal, letter-dot/paren, and Roman numbering while preserving false positives", () => {
    expect(stripLeadingSectionNumbering("10.2.3. statistical methods")).toBe("statistical methods");
    expect(stripLeadingSectionNumbering("b) findings")).toBe("findings");
    expect(stripLeadingSectionNumbering("x. appendix")).toBe("appendix");
    expect(stripLeadingSectionNumbering("3d structure")).toBe("3d structure");
    expect(stripLeadingSectionNumbering("a study")).toBe("a study");
    expect(stripLeadingSectionNumbering("iv therapy")).toBe("iv therapy");
  });

  it("restores pre-abstract section state on exitAbstract", () => {
    const tracker = new SectionTracker();
    expect(tracker.current).toEqual({ label: "unlabeled", subsection: null });
    expect(tracker.enterAbstract()).toEqual({ label: "abstract", subsection: null });
    expect(tracker.exitAbstract()).toEqual({ label: "unlabeled", subsection: null });
    expect(tracker.pushLatexHeading("part", "Part Overview")).toEqual({
      label: "unlabeled",
      subsection: "Part Overview",
    });
  });
});

describe("preMask Markdown & LaTeX edge cases", () => {
  it("masks YAML front matter, reads bibliography/lang/math keys, and toggles md display math", () => {
    const mdNoMath = "---\ntitle: Study\nbibliography: refs.bib\nlang: en-US\nmath: false\n---\n\\[E=mc^2\\]";
    const r1 = preMask(mdNoMath, "md");
    expect(r1.frontMatter).toEqual({ bibliography: "refs.bib", lang: "en-US", math: false });
    expect(r1.mathRegions).toHaveLength(0);
    expect(r1.maskedText.endsWith("\\[E=mc^2\\]")).toBe(true);

    const mdWithMath = "---\nmath: true\n---\n\\[E=mc^2\\]\n$$\nx + y\n$$";
    const r2 = preMask(mdWithMath, "md");
    expect(r2.frontMatter.math).toBe(true);
    expect(r2.mathRegions.map((m) => m.text)).toEqual(["E=mc^2", "x + y"]);
    expect(r2.report.mathRegions.display).toBe(2);
  });

  it("masks Markdown HTML comments, fenced code, inline code, headings, and pipe tables", () => {
    const md = [
      "<!-- hidden comment -->",
      "```ts",
      "const x = `$p<0.05$`;",
      "```",
      "Inline `a + $b$ + c` stays masked, ``nested ` tick`` too.",
      "| Cohort | Mortality | Note |",
      "|:---|:---:|---:|",
      "| A | 12\\% | ok \\| check |",
      "After table.",
    ].join("\n");

    const res = preMask(md, "md");
    expect(res.maskedText.length).toBe(md.length);
    expect(res.mathRegions).toHaveLength(0);
    expect(res.tables).toHaveLength(1);
    expect(res.tables[0]?.headers).toEqual(["Cohort", "Mortality", "Note"]);
    expect(res.tables[0]?.rows).toEqual([["A", "12\\%", "ok \\| check"]]);
    expect(res.report.tablesParsed).toBe(1);
    expect(res.maskedText.endsWith("\nAfter table.")).toBe(true);
  });

  it("handles LaTeX comments vs even/odd preceding backslashes", () => {
    const src = "A 50\\% rate\nLine2\\\\% masked comment\nNext.";
    const res = preMask(src, "latex");
    expect(res.maskedText).toBe(`A 50\\% rate\nLine2\\\\${MASK_CHAR.repeat(16)}\nNext.`);
  });

  it("extracts nested tabular, booktabs, multicolumn, caption, bibitem, and footnotes", () => {
    const src = [
      "\\section{Methods}",
      "\\begin{table}[ht]",
      "\\caption[Short]{Main demographic table.}",
      "\\begin{tabular}{lll}",
      "\\toprule",
      "Group & \\multicolumn{2}{c}{Score} \\\\",
      "\\midrule",
      "Control & 10 & 12 \\\\",
      "\\bottomrule",
      "\\end{tabular}",
      "\\end{table}",
      "Patients were screened\\footnote{Excluding acute illness.}.",
      "\\begin{verbatim}",
      "\\caption{Must NOT be extracted}",
      "\\end{verbatim}",
      "\\begin{mycustombox}",
      "This stays prose.",
      "\\end{mycustombox}",
      "\\begin{thebibliography}{9}",
      "\\bibitem[Smith 2020]{smith20} Smith J. % trailing comment",
      "Journal Name 2020.",
      "\\end{thebibliography}",
    ].join("\n");

    const res = preMask(src, "latex");
    expect(res.maskedText.length).toBe(src.length);
    expect(res.proseStreams).toEqual([
      expect.objectContaining({
        kind: "caption",
        rawText: "Main demographic table.",
        section: { label: "methods", subsection: null },
      }),
      expect.objectContaining({
        kind: "footnote",
        rawText: "Excluding acute illness.",
        section: { label: "methods", subsection: null },
      }),
    ]);
    expect(res.tables).toHaveLength(1);
    expect(res.tables[0]?.headers).toEqual(["Group", "Score", "Score"]);
    expect(res.tables[0]?.rows).toEqual([["Control", "10", "12"]]);
    expect(res.report.tablesParsed).toBe(1);
    expect(res.report.footnotes).toBe(1);
    expect(res.report.unknownEnvironments).toEqual(["mycustombox"]);
    expect(res.maskedText.includes("This stays prose.")).toBe(true);
    expect(res.bibItems).toHaveLength(1);
    expect(res.bibItems[0]).toMatchObject({
      label: "Smith 2020",
      key: "smith20",
      text: "Smith J. Journal Name 2020.",
    });
  });

  it("enforces all 24 structural commands and blank-line arg termination with CRLF and LF", () => {
    expect(STRUCTURAL_COMMANDS.size).toBe(24);
    for (const cmd of STRUCTURAL_COMMANDS) {
      const sample = `\\${cmd}[opt]{arg}\n\n{kept}`;
      const res = preMask(sample, "latex");
      expect(res.maskedText.endsWith("\n\n{kept}")).toBe(true);
    }

    const crlfBlank = "\\label{sec:1}\r\n\r\n{Paragraph}";
    const rCrlf = preMask(crlfBlank, "latex");
    expect(rCrlf.maskedText.endsWith("\r\n\r\n{Paragraph}")).toBe(true);

    const braceClose = buildBraceCloseMap(`\\cmd[1][2][3]{a}{b}{c}{d}`);
    const seq = scanArgumentSequence(`\\cmd[1][2][3]{a}{b}{c}{d}`, braceClose, 4);
    expect(seq.brackets).toHaveLength(2);
    expect(seq.braces).toHaveLength(0);

    const overLimitArg = `{${"x".repeat(ARG_BRACE_MAX_LEN)}}`;
    const bigSeq = scanArgumentSequence(overLimitArg, buildBraceCloseMap(overLimitArg), 0);
    expect(bigSeq.braces).toHaveLength(0);
  });

  it("enforces 200 user-macro cap, 200-char body cap, \\let aliasing, and \\DeclareCiteCommand", () => {
    const lines: string[] = [];
    for (let k = 0; k < USER_MACRO_MAX_COUNT + 2; k++) {
      lines.push(`\\def\\mac${String.fromCharCode(65 + Math.floor(k / 26), 65 + (k % 26))}{val${k}}`);
    }
    lines.push(`\\newcommand{\\toolong}{${"a".repeat(201)}}`);
    lines.push(`\\newcommand*{\\mycite}[1]{[#1]}`);
    lines.push(`\\DeclareCiteCommand{\\superparencite}{}{}{}{}`);

    const src = lines.join("\n");
    const res = preMask(src, "latex");
    expect(res.userMacros.size).toBe(USER_MACRO_MAX_COUNT);
    expect(res.report.macrosNotExpanded).toEqual(["macHS", "macHT", "toolong", "mycite"]);
    expect(res.customCiteMacros.has("mycite")).toBe(true);
    expect(res.customCiteMacros.has("superparencite")).toBe(true);
    expect(CITE_COMMANDS.size).toBe(28);
    expect(NARRATIVE_CITE_COMMANDS.size).toBe(7);

    const aliasSrc = "\\def\\drug{aspirin}\n\\let\\aliasdrug=\\drug\nPatients took \\aliasdrug.";
    const aliasRes = preMask(aliasSrc, "latex");
    expect(aliasRes.userMacros.get("drug")).toBe("aspirin");
    expect(aliasRes.userMacros.get("aliasdrug")).toBe("aspirin");
    expect(aliasRes.report.macrosNotExpanded).toEqual([]);
  });

  it("records \\item starts and handles raw non-prose env overflow without masking", () => {
    const src = "\\begin{itemize}\n\\item[A] First.\n\\item Second.\n\\end{itemize}\n\\begin{table}unclosed";
    const res = preMask(src, "latex");
    expect(res.listItemStarts).toHaveLength(2);
    expect(res.maskedText.endsWith("\\begin{table}unclosed")).toBe(true);
  });
});

describe("applyLatexSubstitutions and normSentence", () => {
  it("applies escapes, spacing, dashes, quotes, all 12 format macros, scripts, siunitx, and draft deletion", () => {
    const input =
      "10\\% \\$5 A\\&B \\#1 a\\_b x~y\\,z\\;w\\:u\\ v\\quad\\qquad\\! p--q r---s ``hi'' " +
      "\\emph{a}\\textit{b}\\textbf{c}\\textrm{d}\\textsc{e}\\mathrm{f}\\mathit{g}\\mathbf{h}\\text{i}\\textsf{j}\\underline{k}\\hl{l} " +
      "\\colorbox[rgb]{1,0,0}{m}\\textcolor{blue}{n} a\\textsuperscript{2} b\\textsubscript{i} " +
      "\\note{drop}\\fixme{drop}\\marginpar{drop} \\SI{5}{\\kilo\\metre\\per\\hour} \\qty{2}{\\mole\\cubed\\meter\\second\\minute\\day\\litre\\nano\\squared}";

    const res = applyLatexSubstitutions(input);
    expect(res.text).toBe(
      '10% $5 A&B #1 a_b x y z w u v   p-q r-s "hi" ' +
        "abcdefghijkl mn a^2 b_i  5 km/h 2 mol^3msmindLn^2",
    );
    expect(res.unregisteredCommands).toEqual([]);
    assertMapInvariants(input, res.text, res.map);
  });

  it("preserves cite commands and §3.1 commands while capping unregistered & macro recursion at depth 3", () => {
    const input = "\\cite{k1} \\label{l1} \\uone{\\utwo{\\uthree{\\ufour{\\textbf{inner}}}}}";
    const res = applyLatexSubstitutions(input);
    expect(res.text).toBe("\\cite{k1} \\label{l1} \\textbf{inner}");
    expect(res.unregisteredCommands).toEqual(["uone", "utwo", "uthree", "ufour"]);
    assertMapInvariants(input, res.text, res.map);

    const macros = new Map([
      ["mA", "\\mB"],
      ["mB", "\\mC"],
      ["mC", "\\mD"],
      ["mD", "leaf"],
    ]);
    const report = createEmptyImportQualityReport();
    const resMacro = applyLatexSubstitutions("\\mA", { userMacros: macros, report });
    expect(resMacro.text).toBe("");
    expect(report.macrosNotExpanded).toEqual(["mD"]);
  });

  it("handles pre-masked U+E000 sentinels and citation marker ranges in normSentence / sentenceHash", () => {
    const masked = `We\uE000\uE000\uE000 measured\n $p < 0.05$  [1].`;
    const citeIdx = masked.indexOf("[1]");
    const normalized = normSentence(masked, {
      format: "latex",
      markerRanges: [{ start: citeIdx, end: citeIdx + 3 }],
    });
    expect(normalized).toBe("we measured p < 0.05 ⟦c⟧.");
    expect(sentenceHash(masked, { format: "latex", markerRanges: [{ start: citeIdx, end: citeIdx + 3 }] })).toHaveLength(64);
  });

  it("handles nested formatting/draft macros around math/citations/footnotes and protects math quotes", () => {
    const withMath = "We saw \\emph{values with $p<0.05$} and $f''(x) = 2$.";
    expect(normSentence(withMath, { format: "latex" })).toBe(
      "we saw values with p<0.05 and f''(x) = 2.",
    );

    const withColor = "Values were \\textcolor{red}{higher at $p<0.05$}.";
    expect(normSentence(withColor, { format: "latex" })).toBe(
      "values were higher at p<0.05.",
    );

    const withTodo = "Check \\todo{verify $p<0.05$} here.";
    expect(normSentence(withTodo, { format: "latex" })).toBe("check here.");

    const withCite = "As in \\emph{prior work \\cite{a}}.";
    const citePos = withCite.indexOf("\\cite{a}");
    expect(
      normSentence(withCite, {
        format: "latex",
        markerRanges: [{ start: citePos, end: citePos + 8 }],
      }),
    ).toBe("as in prior work ⟦c⟧.");

    const withFootnote = "Result \\emph{was high\\footnote{ignored} overall}.";
    expect(normSentence(withFootnote, { format: "latex" })).toBe(
      "result was high overall.",
    );
  });

  it("does not misclassify malformed §3.2 commands as unregistered or delete literal [1] after 0-arg command", () => {
    const malformed = applyLatexSubstitutions("\\textbf text \\textcolor{red} \\SI{5} \\ce");
    expect(malformed.unregisteredCommands).toEqual([]);
    expect(malformed.text).toBe(" text  5 ");
    assertMapInvariants("\\textbf text \\textcolor{red} \\SI{5} \\ce", malformed.text, malformed.map);

    const zeroArgBracket = applyLatexSubstitutions("\\newline [1] kept");
    expect(zeroArgBracket.text).toBe(" [1] kept");
    expect(zeroArgBracket.unregisteredCommands).toEqual(["newline"]);
  });

  it("handles validator regression edge cases for fences, %-comments in braces, tabular*, \\$$$, and YAML comments", () => {
    const fenceSrc = "````\nunclosed\n```ts\nconst x=1;\n```\nAfter.";
    const fenceRes = preMask(fenceSrc, "md");
    expect(fenceRes.regions.filter((r) => r.kind === "fenced_code")).toHaveLength(1);
    expect(fenceRes.maskedText.startsWith("````\nunclosed\n")).toBe(true);
    expect(fenceRes.maskedText.endsWith("\nAfter.")).toBe(true);

    const yamlComment = '---\nlang: "de" # German\nmath: "true" # enable\n---\nBody';
    const yamlRes = preMask(yamlComment, "md");
    expect(yamlRes.frontMatter).toEqual({ lang: "de", math: true });

    const cmtMacro = "\\newcommand{\\foo}{bar % {\n}\n\\section{Methods}\nBody.";
    const cmtMacroRes = preMask(cmtMacro, "latex");
    expect(cmtMacroRes.userMacros.get("foo")).toBe("bar % {\n");
    expect(cmtMacroRes.sectionTransitions.map((t) => t.state)).toEqual([
      { label: "methods", subsection: null },
    ]);

    const cmtFoot = "Hi\\footnote{see % }\nmore text.} Bye.";
    const cmtFootRes = preMask(cmtFoot, "latex");
    expect(cmtFootRes.proseStreams).toHaveLength(1);
    expect(cmtFootRes.proseStreams[0]?.rawText).toBe("see % }\nmore text.");
    expect(cmtFootRes.maskedText.endsWith(" Bye.")).toBe(true);

    const nlMath = "Cost is $a\\\nnext line $b$";
    const nlMathRes = preMask(nlMath, "latex");
    expect(nlMathRes.mathRegions).toHaveLength(1);
    expect(nlMathRes.mathRegions[0]?.raw).toBe("$b$");

    const escDollarDisplay = "$$x \\$$$ y$$";
    const escDollarRes = preMask(escDollarDisplay, "latex");
    expect(escDollarRes.mathRegions).toHaveLength(1);
    expect(escDollarRes.mathRegions[0]?.raw).toBe("$$x \\$$$");

    const tabStar = "\\begin{tabular*}{\\textwidth}[t]{ll}\nA & B \\\\\n1 & 2\n\\end{tabular*}";
    const tabStarRes = preMask(tabStar, "latex");
    expect(tabStarRes.tables).toHaveLength(1);
    expect(tabStarRes.tables[0]?.headers).toEqual(["A", "B"]);
    expect(tabStarRes.tables[0]?.rows).toEqual([["1", "2"]]);

    const footBlank = "\\footnote[1]\n\n{Paragraph}";
    const footBlankRes = preMask(footBlank, "latex");
    expect(footBlankRes.proseStreams).toHaveLength(0);
    expect(footBlankRes.maskedText).toBe(footBlank);

    const letLines: string[] = [];
    for (let k = 0; k < USER_MACRO_MAX_COUNT; k++) {
      letLines.push(`\\def\\m${String.fromCharCode(65 + Math.floor(k / 26), 65 + (k % 26))}{v}`);
    }
    letLines.push("\\let\\overflowAlias=\\mAA");
    const letRes = preMask(letLines.join("\n"), "latex");
    expect(letRes.report.macrosNotExpanded).toEqual(["overflowAlias"]);

    for (const envName of ["verbatim", "comment", "lstlisting", "minted"]) {
      const closedFollowedByUnclosed =
        `\\begin{${envName}}\nhidden body\n\\end{${envName}}\nNormal prose.\n\\begin{${envName}}\nunclosed tail`;
      const envRes = preMask(closedFollowedByUnclosed, "latex");
      const maskedBlocks = envRes.regions.filter((r) => r.kind === "non_prose_env");
      expect(maskedBlocks).toHaveLength(1);
      expect(envRes.maskedText.includes("Normal prose.")).toBe(true);
      expect(envRes.maskedText.includes("hidden body")).toBe(false);
      expect(envRes.maskedText.endsWith("unclosed tail")).toBe(true);
    }
  });
});

describe("10 KB adversarial unclosed-delimiter latency guard (<= 5 ms median)", () => {
  it("scans 10 KB adversarial inputs strictly under 5 ms median", () => {
    const cases: readonly { readonly name: string; readonly run: () => void }[] = [
      {
        name: "unclosed latex display brackets",
        run: () => preMask("\\[ ".repeat(3500), "latex"),
      },
      {
        name: "unclosed latex display brackets + escaped \\\\]",
        run: () => preMask("\\[ ".repeat(1500) + "\\\\] ".repeat(1500), "latex"),
      },
      {
        name: "unclosed latex inline parens",
        run: () => preMask("\\( ".repeat(3500), "latex"),
      },
      {
        name: "unclosed display $$",
        run: () => preMask("$$x + ".repeat(2000), "latex"),
      },
      {
        name: "unclosed inline $ in md",
        run: () => preMask("$x ".repeat(3500), "md"),
      },
      {
        name: "unclosed nested tables + 1 end",
        run: () => preMask(`${"\\begin{table}".repeat(800)}\\end{table}`, "latex"),
      },
      {
        name: "unclosed section braces",
        run: () => preMask("\\section{".repeat(1200), "latex"),
      },
      {
        name: "unclosed markdown backtick fences",
        run: () => preMask("```\n".repeat(2600), "md"),
      },
      {
        name: "unclosed 4-tick + 3-tick mixed markdown fences",
        run: () => preMask(`\`\`\`\`\n${"```\n".repeat(2500)}`, "md"),
      },
      {
        name: "unclosed markdown info-string fences",
        run: () => preMask("```x\n".repeat(2100), "md"),
      },
      {
        name: "unclosed latex equation env",
        run: () => preMask("\\begin{equation}".repeat(700), "latex"),
      },
      {
        name: "unclosed latex verbatim env",
        run: () => preMask("\\begin{verbatim}".repeat(700), "latex"),
      },
      {
        name: "unclosed HTML comments",
        run: () => preMask("<!-- ".repeat(2100), "md"),
      },
      {
        name: "unclosed mathText fractions",
        run: () => mathText(`$${"\\frac{".repeat(1700)}`),
      },
      {
        name: "unclosed applyLatexSubstitutions",
        run: () => applyLatexSubstitutions("\\gls{".repeat(2100)),
      },
    ];

    for (const tc of cases) {
      const med = medianMs(tc.run);
      expect(med, `${tc.name} took ${med.toFixed(2)} ms`).toBeLessThanOrEqual(5);
    }
  });
});
