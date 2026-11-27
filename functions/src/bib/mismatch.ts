import { BM25_STOPWORDS, foldLatin, normLower } from "@toulmin/core-l0";

/**
 * Normalizes a DOI per `05` §3.1 step 1:
 * strips `https://doi.org/`, `http://dx.doi.org/`, `http://doi.org/`, `https://dx.doi.org/`,
 * and `doi:`, trims whitespace, and lowercases. Never re-scans `.bib` DOI strings.
 */
export function normalizeDoi(raw: string): string {
  let s = raw.trim();
  const lower = s.toLowerCase();
  for (const prefix of [
    "https://doi.org/",
    "http://doi.org/",
    "https://dx.doi.org/",
    "http://dx.doi.org/",
    "doi:",
  ]) {
    if (lower.startsWith(prefix)) {
      s = s.slice(prefix.length).trim();
      break;
    }
  }
  return s.toLowerCase();
}

function tokenizeTitle(raw: string): string[] {
  const folded = foldLatin(normLower(raw));
  const tokens: string[] = [];
  let cur = "";
  for (let i = 0; i < folded.length; i += 1) {
    const ch = folded.charAt(i);
    const cu = folded.charCodeAt(i);
    const isAlphaNum =
      (cu >= 0x30 && cu <= 0x39) ||
      (cu >= 0x61 && cu <= 0x7a) ||
      (cu >= 0xc0 && cu <= 0x024f);
    if (isAlphaNum) {
      cur += ch;
    } else if (cur.length > 0) {
      if (!BM25_STOPWORDS.has(cur)) {
        tokens.push(cur);
      }
      cur = "";
    }
  }
  if (cur.length > 0 && !BM25_STOPWORDS.has(cur)) {
    tokens.push(cur);
  }
  return tokens;
}

/**
 * Computes `titleSim(a, b)` per `05` §3.1 step 7:
 * `max(Jaccard(tokens(a'), tokens(b')), containment(shorter, longer))`
 * after `foldLatin(normLower(.))`, stopword deletion, and stripping everything
 * after the first `:` when the other title has no `:`.
 */
export function titleSim(a: string, b: string): number {
  let left = a.trim();
  let right = b.trim();
  const leftColon = left.indexOf(":");
  const rightColon = right.indexOf(":");
  if (leftColon !== -1 && rightColon === -1) {
    left = left.slice(0, leftColon);
  } else if (rightColon !== -1 && leftColon === -1) {
    right = right.slice(0, rightColon);
  }

  const tokA = new Set(tokenizeTitle(left));
  const tokB = new Set(tokenizeTitle(right));
  if (tokA.size === 0 && tokB.size === 0) return 1;
  if (tokA.size === 0 || tokB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokA) {
    if (tokB.has(t)) intersection += 1;
  }
  const union = tokA.size + tokB.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;
  const minSize = Math.min(tokA.size, tokB.size);
  const containment = minSize > 0 ? intersection / minSize : 0;
  return Math.max(jaccard, containment);
}

const CONSORTIUM_WORDS = [
  "group",
  "consortium",
  "collaboration",
  "investigators",
  "committee",
  "network",
  "study",
];

export function isConsortiumAuthor(rawAuthor: string): boolean {
  const folded = foldLatin(normLower(rawAuthor));
  const words = folded.split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  return words.some((w) => CONSORTIUM_WORDS.includes(w));
}

const NAME_PARTICLES = new Set([
  "van",
  "von",
  "de",
  "del",
  "di",
  "da",
  "la",
  "le",
  "du",
  "der",
]);

function stripParticlesAndNormalizeTokens(segment: string): string {
  const folded = foldLatin(normLower(segment));
  const words = folded
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !NAME_PARTICLES.has(w));
  return words.join(" ");
}

/**
 * Extracts candidate family names from a `.bib` or API author string,
 * trying both `Last, First` and `First Last` parses after particle and diacritic stripping.
 */
export function extractFamilyNameCandidates(rawAuthor: string): string[] {
  const trimmed = rawAuthor.trim();
  if (!trimmed) return [];

  const candidates = new Set<string>();
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx !== -1) {
    const beforeComma = stripParticlesAndNormalizeTokens(trimmed.slice(0, commaIdx));
    if (beforeComma) candidates.add(beforeComma);
  }

  // First Last parse: take last non-particle token (or trailing tokens after stripping particles)
  const words = foldLatin(normLower(trimmed))
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
  if (words.length > 0) {
    const lastWord = words[words.length - 1]!;
    if (!NAME_PARTICLES.has(lastWord)) {
      candidates.add(lastWord);
    }
    const noParticles = words.filter((w) => !NAME_PARTICLES.has(w));
    if (noParticles.length > 0) {
      candidates.add(noParticles[noParticles.length - 1]!);
    }
    // Also support compound family name without leading given name if comma-separated wasn't used
    if (words.length >= 2) {
      const rest = words.slice(1).filter((w) => !NAME_PARTICLES.has(w));
      if (rest.length > 0) {
        candidates.add(rest.join(" "));
      }
    }
  }

  return Array.from(candidates);
}

export function firstAuthorsMatch(
  bibFirstAuthor: string,
  resolvedFirstAuthor: { readonly family: string; readonly given?: string }
): boolean {
  if (isConsortiumAuthor(bibFirstAuthor)) {
    return true;
  }
  const bibCandidates = new Set(extractFamilyNameCandidates(bibFirstAuthor));
  const resolvedNormalized = stripParticlesAndNormalizeTokens(resolvedFirstAuthor.family);
  const resolvedCandidates = new Set([
    ...extractFamilyNameCandidates(
      resolvedFirstAuthor.given
        ? `${resolvedFirstAuthor.given} ${resolvedFirstAuthor.family}`
        : resolvedFirstAuthor.family
    ),
    ...(resolvedNormalized ? [resolvedNormalized] : []),
  ]);

  for (const c of bibCandidates) {
    if (resolvedCandidates.has(c)) {
      return true;
    }
  }
  return false;
}

export interface MetadataMismatchInput {
  readonly title?: string | undefined;
  readonly year?: number | undefined;
  readonly authors?: readonly string[] | undefined;
}

export interface ResolvedMetadataComparison {
  readonly title: string | null;
  readonly year: number | null;
  readonly firstAuthor: { readonly family: string; readonly given?: string } | null;
  readonly isPreprint: boolean;
}

/**
 * Computes tolerant metadata mismatch flags (`05` §3.1 step 7).
 */
export function computeMetadataMismatch(
  input: MetadataMismatchInput,
  resolved: ResolvedMetadataComparison,
  inputIsPreprint = false
): Array<"TITLE" | "YEAR" | "FIRST_AUTHOR"> {
  const flags: Array<"TITLE" | "YEAR" | "FIRST_AUTHOR"> = [];

  if (input.title && resolved.title) {
    if (titleSim(input.title, resolved.title) < 0.5) {
      flags.push("TITLE");
    }
  }

  if (
    input.year !== undefined &&
    resolved.year !== null &&
    !resolved.isPreprint &&
    !inputIsPreprint
  ) {
    if (Math.abs(input.year - resolved.year) > 1) {
      flags.push("YEAR");
    }
  }

  if (input.authors && input.authors.length > 0 && resolved.firstAuthor) {
    const firstBibAuthor = input.authors[0]!;
    if (!firstAuthorsMatch(firstBibAuthor, resolved.firstAuthor)) {
      flags.push("FIRST_AUTHOR");
    }
  }

  return flags;
}

/**
 * Extracts the longest quoted or sentence-cased segment from a raw bibliographic reference string
 * for Crossref query verification (`05` §3.1 step 5).
 */
export function longestQuotedOrSentenceSegment(raw: string): string {
  const quotes: string[] = [];
  for (const [open, close] of [
    ['"', '"'],
    ["\u201c", "\u201d"],
  ] as const) {
    let idx = 0;
    while (idx < raw.length) {
      const start = raw.indexOf(open, idx);
      if (start === -1) break;
      const end = raw.indexOf(close, start + 1);
      if (end === -1) break;
      const inner = raw.slice(start + 1, end).trim();
      if (inner.length > 0) quotes.push(inner);
      idx = end + 1;
    }
  }
  if (quotes.length > 0) {
    return quotes.sort((a, b) => b.length - a.length)[0]!;
  }

  const segments = raw
    .split(/[.?!]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return raw.trim();
  return segments.sort((a, b) => b.length - a.length)[0]!;
}
