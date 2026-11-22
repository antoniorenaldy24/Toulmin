/**
 * Hierarchical section label canonicalizer and import-quality report types
 * (`docs/spec/02_L0_TIER_A_PRE_DECODE.md` §3.4–§3.5).
 *
 * Pure TypeScript using `norm()` / `normLower()` from `./norm.js`:
 * zero regular expressions, zero `.toLowerCase()`.
 */

import { isDigit, isSpace, norm, normLower } from "./norm.js";

export type CanonicalSectionLabel =
  | "abstract"
  | "introduction"
  | "methods"
  | "results"
  | "discussion"
  | "limitations"
  | "conclusion"
  | "supplementary"
  | "references"
  | "unlabeled";

export type LatexSectionCommand =
  | "part"
  | "chapter"
  | "section"
  | "subsection"
  | "subsubsection"
  | "paragraph";

export const LATEX_SECTION_LEVELS: Readonly<Record<LatexSectionCommand, number>> = {
  part: 1,
  chapter: 2,
  section: 3,
  subsection: 4,
  subsubsection: 5,
  paragraph: 6,
};

export interface SectionState {
  readonly label: CanonicalSectionLabel;
  readonly subsection: string | null;
}

export interface HeadingInput {
  readonly level: number;
  readonly heading: string;
}

export interface SkippedFileRecord {
  readonly file: string;
  readonly reason: string;
}

export interface ImportQualityReport {
  filesRead: number;
  filesSkipped: number;
  skippedFiles: SkippedFileRecord[];
  unresolvedInputs: string[];
  macrosNotExpanded: string[];
  unregisteredCommands: string[];
  unknownEnvironments: string[];
  tablesParsed: number;
  mathRegions: {
    inline: number;
    display: number;
  };
  footnotes: number;
  parseTimeouts: string[];
  unresolvedKeys: string[];
  possibleCitations: string[];
}

export function createEmptyImportQualityReport(): ImportQualityReport {
  return {
    filesRead: 0,
    filesSkipped: 0,
    skippedFiles: [],
    unresolvedInputs: [],
    macrosNotExpanded: [],
    unregisteredCommands: [],
    unknownEnvironments: [],
    tablesParsed: 0,
    mathRegions: {
      inline: 0,
      display: 0,
    },
    footnotes: 0,
    parseTimeouts: [],
    unresolvedKeys: [],
    possibleCitations: [],
  };
}

interface PrefixRule {
  readonly label: Exclude<CanonicalSectionLabel, "abstract" | "unlabeled">;
  readonly prefixes: readonly string[];
}

const CANONICAL_PREFIX_RULES: readonly PrefixRule[] = [
  {
    label: "introduction",
    prefixes: [
      "introduction",
      "background",
      "related work",
      "literature review",
      "prior work",
      "motivation",
    ],
  },
  {
    label: "methods",
    prefixes: [
      "method",
      "materials and methods",
      "material and methods",
      "methodology",
      "experimental design",
      "experimental setup",
      "experimental procedures",
      "study design",
      "study population",
      "participants",
      "patients and methods",
      "data and methods",
      "data collection",
      "statistical analysis",
      "statistical methods",
      "measures",
      "procedure",
    ],
  },
  {
    label: "results",
    prefixes: ["result", "findings"],
  },
  {
    label: "discussion",
    prefixes: ["discussion", "general discussion"],
  },
  {
    label: "limitations",
    prefixes: ["limitation"],
  },
  {
    label: "conclusion",
    prefixes: ["conclusion", "concluding remarks"],
  },
  {
    label: "supplementary",
    prefixes: ["supplement", "appendix", "supporting information"],
  },
  {
    label: "references",
    prefixes: [
      "references",
      "bibliography",
      "works cited",
      "literature cited",
      "reference list",
    ],
  },
];

/** Trims leading and trailing L0 `SPACE` characters (`0x20, 0x09, 0x0A, 0x0D`). */
export function trimSpace(input: string): string {
  const n = input.length;
  let start = 0;
  while (start < n && isSpace(input.charCodeAt(start))) {
    start++;
  }
  let end = n;
  while (end > start && isSpace(input.charCodeAt(end - 1))) {
    end--;
  }
  return input.slice(start, end);
}

function isLowerAsciiLetter(code: number): boolean {
  return code >= 97 && code <= 122;
}

function isRomanLowerChar(code: number): boolean {
  return (
    code === 105 || // i
    code === 118 || // v
    code === 120 || // x
    code === 108 || // l
    code === 99 || // c
    code === 100 || // d
    code === 109 // m
  );
}

/**
 * Strips leading section numbering from an already `normLower()`-ed & trimmed heading:
 * - Decimal (`2.1 `, `2.1. `, `1) `, `1 `)
 * - Single ASCII letter with `.` or `)` (`a. `, `b) `; never `"a study"`)
 * - Lowercase Roman numerals over `{i,v,x,l,c,d,m}` with `.` or `)` (`ii. `, `iv) `; never `"iv therapy"`)
 */
export function stripLeadingSectionNumbering(lowerTrimmed: string): string {
  const n = lowerTrimmed.length;
  if (n === 0) {
    return lowerTrimmed;
  }

  // 1. Decimal prefix: digits ('.' digits)* followed by optional '.' / ')', then space(s)
  if (isDigit(lowerTrimmed.charCodeAt(0))) {
    let i = 0;
    while (i < n && isDigit(lowerTrimmed.charCodeAt(i))) {
      i++;
    }
    while (i + 1 < n && lowerTrimmed.charCodeAt(i) === 46 && isDigit(lowerTrimmed.charCodeAt(i + 1))) {
      i++;
      while (i < n && isDigit(lowerTrimmed.charCodeAt(i))) {
        i++;
      }
    }
    if (i < n && (lowerTrimmed.charCodeAt(i) === 46 || lowerTrimmed.charCodeAt(i) === 41)) {
      i++;
    }
    if (i < n && isSpace(lowerTrimmed.charCodeAt(i))) {
      while (i < n && isSpace(lowerTrimmed.charCodeAt(i))) {
        i++;
      }
      if (i < n) {
        return lowerTrimmed.slice(i);
      }
    }
  }

  // 2. Single letter + '.' / ')' + space(s)
  if (
    n >= 4 &&
    isLowerAsciiLetter(lowerTrimmed.charCodeAt(0)) &&
    (lowerTrimmed.charCodeAt(1) === 46 || lowerTrimmed.charCodeAt(1) === 41) &&
    isSpace(lowerTrimmed.charCodeAt(2))
  ) {
    let i = 2;
    while (i < n && isSpace(lowerTrimmed.charCodeAt(i))) {
      i++;
    }
    if (i < n) {
      return lowerTrimmed.slice(i);
    }
  }

  // 3. Roman numeral over {i,v,x,l,c,d,m}+ + '.' / ')' + space(s)
  if (isRomanLowerChar(lowerTrimmed.charCodeAt(0))) {
    let i = 0;
    while (i < n && isRomanLowerChar(lowerTrimmed.charCodeAt(i))) {
      i++;
    }
    if (i < n && (lowerTrimmed.charCodeAt(i) === 46 || lowerTrimmed.charCodeAt(i) === 41)) {
      i++;
      if (i < n && isSpace(lowerTrimmed.charCodeAt(i))) {
        while (i < n && isSpace(lowerTrimmed.charCodeAt(i))) {
          i++;
        }
        if (i < n) {
          return lowerTrimmed.slice(i);
        }
      }
    }
  }

  return lowerTrimmed;
}

/**
 * Matches a single heading string to a canonical section label in exact spec table order,
 * or returns `null` when unmatched.
 */
export function matchCanonicalSectionLabel(
  rawHeading: string,
  isFirstHeading: boolean,
): CanonicalSectionLabel | null {
  const lowered = trimSpace(normLower(rawHeading));
  const candidate = trimSpace(stripLeadingSectionNumbering(lowered));
  if (candidate.length === 0) {
    return null;
  }

  if (candidate === "abstract") {
    return "abstract";
  }
  if (isFirstHeading && candidate === "summary") {
    return "abstract";
  }

  for (const rule of CANONICAL_PREFIX_RULES) {
    for (const prefix of rule.prefixes) {
      if (candidate.startsWith(prefix)) {
        return rule.label;
      }
    }
  }

  return null;
}

interface SectionFrame {
  readonly level: number;
  readonly label: CanonicalSectionLabel;
  readonly subsection: string | null;
}

/**
 * Stateful hierarchical section tracker (`02` §3.4).
 * Supports both LaTeX section levels (`LATEX_SECTION_LEVELS`) and Markdown `#` counts (`1..6`).
 */
export class SectionTracker {
  private readonly stack: SectionFrame[] = [];
  private hasSeenHeading = false;
  private savedBeforeAbstract: SectionFrame[] | null = null;
  private activeState: SectionState = { label: "unlabeled", subsection: null };

  get current(): SectionState {
    return this.activeState;
  }

  /**
   * Transitions tracker state into a LaTeX `\begin{abstract}` environment.
   */
  enterAbstract(): SectionState {
    if (this.savedBeforeAbstract === null) {
      this.savedBeforeAbstract = [...this.stack];
    }
    this.activeState = { label: "abstract", subsection: null };
    return this.activeState;
  }

  /**
   * Restores the enclosing section state after `\end{abstract}`.
   */
  exitAbstract(): SectionState {
    if (this.savedBeforeAbstract !== null) {
      this.stack.length = 0;
      for (const frame of this.savedBeforeAbstract) {
        this.stack.push(frame);
      }
      this.savedBeforeAbstract = null;
    }
    const top = this.stack[this.stack.length - 1];
    this.activeState =
      top !== undefined
        ? { label: top.label, subsection: top.subsection }
        : { label: "unlabeled", subsection: null };
    return this.activeState;
  }

  /**
   * Processes a heading at hierarchical `level` (`1..6`) with raw text `rawHeading`,
   * updating the ancestor stack and returning the resulting `SectionState`.
   */
  pushHeading(level: number, rawHeading: string): SectionState {
    this.savedBeforeAbstract = null;
    const isFirst = !this.hasSeenHeading;
    this.hasSeenHeading = true;

    while (this.stack.length > 0) {
      const top = this.stack[this.stack.length - 1];
      if (top !== undefined && top.level >= level) {
        this.stack.pop();
      } else {
        break;
      }
    }

    const parent = this.stack[this.stack.length - 1];
    const matched = matchCanonicalSectionLabel(rawHeading, isFirst);

    let nextState: SectionState;
    if (matched !== null) {
      nextState = { label: matched, subsection: null };
    } else {
      const normalizedRaw = trimSpace(norm(rawHeading).text);
      const inheritedLabel: CanonicalSectionLabel = parent !== undefined ? parent.label : "unlabeled";
      nextState = {
        label: inheritedLabel,
        subsection: normalizedRaw.length > 0 ? normalizedRaw : null,
      };
    }

    this.stack.push({
      level,
      label: nextState.label,
      subsection: nextState.subsection,
    });
    this.activeState = nextState;
    return nextState;
  }

  /** Convenience wrapper for LaTeX section commands (`part`..`paragraph`). */
  pushLatexHeading(command: LatexSectionCommand, rawHeading: string): SectionState {
    return this.pushHeading(LATEX_SECTION_LEVELS[command], rawHeading);
  }
}

/**
 * Resolves a sequence of headings into their `SectionState` snapshots in order.
 */
export function resolveHeadingSequence(headings: readonly HeadingInput[]): SectionState[] {
  const tracker = new SectionTracker();
  const states: SectionState[] = [];
  for (const item of headings) {
    states.push(tracker.pushHeading(item.level, item.heading));
  }
  return states;
}
