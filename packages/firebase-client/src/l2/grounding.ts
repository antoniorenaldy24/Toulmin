/**
 * Web grounding card renderer & "This paper" DOI path-segment matcher
 * (`04` §4.1 step 3, §4.4, `05` §2.3, D-19, D-22, AC-GND-01, AC-GND-02).
 *
 * Uses a Blob URL (`type: "text/html"`) with `sandbox="allow-popups allow-popups-to-escape-sandbox"`
 * (never `srcdoc`, never `allow-scripts`/`allow-same-origin`), revokes Blob URLs on close,
 * renders `https:`-only grounding links via plain DOM APIs (never `innerHTML`), and never
 * attaches click tracking or persists grounded content.
 */

import { EN_COPY, formatCloudReloadLabel } from "@toulmin/copy";

export const GROUNDING_IFRAME_SANDBOX = "allow-popups allow-popups-to-escape-sandbox" as const;

export interface GroundingChunk {
  readonly web?: {
    readonly uri?: string;
    readonly title?: string;
  };
}

export interface GroundingDisplaySource {
  readonly uri: string;
  readonly title: string;
  readonly isThisPaper: boolean;
}

export interface DomElementLike {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  appendChild(child: DomElementLike): DomElementLike;
}

export interface IframeElementLike extends DomElementLike {
  src: string;
  sandbox?: string | { value: string };
}

export interface GroundingDomDeps {
  readonly createElement?: (tagName: string) => DomElementLike;
  readonly createObjectURL?: (blob: Blob) => string;
  readonly revokeObjectURL?: (url: string) => void;
}

export interface GroundingIframeHandle {
  readonly iframe: IframeElementLike;
  readonly blobUrl: string;
  dispose(): void;
}

export function isSafeHttpsUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitNonEmptyPathSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Checks whether a grounding chunk URI matches the cited reference (`04` §4.1 step 3):
 * - URI scheme is `https:`, AND
 * - after URL decoding and lowercasing, the path contains the reference DOI as an
 *   exact path-segment sequence (e.g. `https://doi.org/10.1234/abc`,
 *   `.../doi/full/10.1234/abc`), OR
 * - URI hostname equals `publisherHost` (derived from Crossref `resource.primary.URL`).
 *
 * A DOI in a chunk title or query string never counts.
 */
export function isThisPaperGroundingUri(
  uri: string,
  refDoi: string | null | undefined,
  publisherHost?: string | null
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }

  const normalizedPublisherHost = publisherHost?.trim().toLowerCase() ?? "";
  if (
    normalizedPublisherHost.length > 0 &&
    parsed.hostname.toLowerCase() === normalizedPublisherHost
  ) {
    return true;
  }

  const normalizedDoi = refDoi?.trim().toLowerCase() ?? "";
  if (normalizedDoi.length === 0) {
    return false;
  }

  const decodedPath = safeDecodeURIComponent(parsed.pathname).toLowerCase();
  const pathSegments = splitNonEmptyPathSegments(decodedPath);
  const doiSegments = splitNonEmptyPathSegments(normalizedDoi);
  if (doiSegments.length === 0 || pathSegments.length < doiSegments.length) {
    return false;
  }

  for (let start = 0; start <= pathSegments.length - doiSegments.length; start += 1) {
    let allMatch = true;
    for (let offset = 0; offset < doiSegments.length; offset += 1) {
      if (pathSegments[start + offset] !== doiSegments[offset]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      return true;
    }
  }

  return false;
}

export function filterGroundingSources(
  chunks: readonly GroundingChunk[],
  options: {
    readonly refDoi?: string | null;
    readonly publisherHost?: string | null;
  }
): GroundingDisplaySource[] {
  const sources: GroundingDisplaySource[] = [];
  for (const chunk of chunks) {
    const uri = chunk.web?.uri;
    if (typeof uri !== "string" || !isSafeHttpsUri(uri)) {
      continue;
    }
    const rawTitle = chunk.web?.title;
    const title = typeof rawTitle === "string" && rawTitle.trim().length > 0 ? rawTitle : uri;
    sources.push({
      uri,
      title,
      isThisPaper: isThisPaperGroundingUri(uri, options.refDoi, options.publisherHost),
    });
  }
  return sources;
}

/**
 * Renders unmodified `searchEntryPoint.renderedContent` inside a sandboxed Blob-URL
 * iframe (`04` §4.4, `05` §2.3, AC-GND-02). Never uses `srcdoc`.
 */
export function createGroundingIframe(
  renderedContent: string,
  deps?: GroundingDomDeps
): GroundingIframeHandle {
  const createElement =
    deps?.createElement ??
    ((tag: string) => document.createElement(tag) as unknown as DomElementLike);
  const createObjectURL = deps?.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectURL = deps?.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url));

  const blob = new Blob([renderedContent], { type: "text/html" });
  const blobUrl = createObjectURL(blob);

  const iframe = createElement("iframe") as IframeElementLike;
  iframe.setAttribute("sandbox", GROUNDING_IFRAME_SANDBOX);
  if (typeof iframe.sandbox === "string") {
    iframe.sandbox = GROUNDING_IFRAME_SANDBOX;
  }
  iframe.src = blobUrl;

  let disposed = false;
  return {
    iframe,
    blobUrl,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      revokeObjectURL(blobUrl);
    },
  };
}

/**
 * Builds the `https:`-only grounding sources list using plain DOM APIs (never `innerHTML`,
 * never click tracking) (`04` §4.4, AC-GND-02).
 */
export function renderGroundingSourcesList(
  chunks: readonly GroundingChunk[],
  options: {
    readonly refDoi?: string | null;
    readonly publisherHost?: string | null;
  },
  deps?: Pick<GroundingDomDeps, "createElement">
): DomElementLike {
  const createElement =
    deps?.createElement ??
    ((tag: string) => document.createElement(tag) as unknown as DomElementLike);

  const list = createElement("ul");
  const sources = filterGroundingSources(chunks, options);

  for (const source of sources) {
    const item = createElement("li");
    const link = createElement("a");
    link.setAttribute("href", source.uri);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    link.textContent = source.title;
    item.appendChild(link);

    if (source.isThisPaper) {
      const badge = createElement("span");
      badge.setAttribute("data-toulmin-badge", "this-paper");
      badge.textContent = EN_COPY.cloud.thisPaperBadge;
      item.appendChild(badge);
    }

    list.appendChild(item);
  }

  return list;
}

export function formatCloudReloadLabelFromTimestamp(
  decidedAt: number,
  locale?: string
): string {
  const formattedDate = new Intl.DateTimeFormat(locale).format(new Date(decidedAt));
  return formatCloudReloadLabel(formattedDate);
}
