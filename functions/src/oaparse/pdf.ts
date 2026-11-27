import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { OaParseResponse } from "@toulmin/schemas";
import {
  chunkPdfPages,
  scanPage1ArxivId,
  scanPage1Doi,
  type PdfPageInput,
  type PdfTextItem,
} from "../oa/chunk.js";

export type PdfPageExtractorFn = (bytes: Uint8Array) => Promise<PdfPageInput[]>;

interface PdfJsTextItemLike {
  readonly str?: unknown;
  readonly transform?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
}

/**
 * Default Node.js `pdfjs-dist` legacy extractor (`isEvalSupported: false`, `05` §1.1, §3.2.4, `00` §6.2).
 */
export async function extractPdfPagesWithPdfJs(bytes: Uint8Array): Promise<PdfPageInput[]> {
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;
  try {
    const pages: PdfPageInput[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const rawItem of textContent.items) {
        const item = rawItem as PdfJsTextItemLike;
        if (typeof item.str !== "string" || item.str.length === 0) continue;
        const tr = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
        const x = typeof tr[4] === "number" ? tr[4] : 0;
        const y = typeof tr[5] === "number" ? tr[5] : 0;
        const rawHeight = typeof item.height === "number" ? item.height : 0;
        const fallbackHeight = Math.hypot(
          typeof tr[2] === "number" ? tr[2] : 0,
          typeof tr[3] === "number" ? tr[3] : 0
        );
        const height = rawHeight > 0 ? rawHeight : fallbackHeight > 0 ? fallbackHeight : 10;
        const width = typeof item.width === "number" ? item.width : item.str.length * height * 0.5;
        items.push({
          str: item.str,
          x,
          y,
          width,
          height,
        });
      }
      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        viewBox: viewport.viewBox as unknown as readonly [number, number, number, number],
        items,
      });
    }
    return pages;
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

/**
 * Extracts the largest-font line group on page 1 as fallback identity title (`05` §3.2.5 step 1).
 */
export function extractFirstPageTitle(page1: PdfPageInput | undefined): string | null {
  if (!page1 || page1.items.length === 0) return null;
  const visible = page1.items.filter((it) => it.height >= 2 && it.str.trim().length > 0);
  if (visible.length === 0) return null;

  let maxH = 0;
  for (const it of visible) {
    if (it.height > maxH) maxH = it.height;
  }
  const titleItems = visible.filter((it) => it.height >= maxH - 0.5);
  if (titleItems.length === 0) return null;

  const sorted = [...titleItems].sort((a, b) => {
    if (Math.abs(b.y - a.y) > 0.5 * maxH) return b.y - a.y;
    return a.x - b.x;
  });
  const text = sorted.map((it) => it.str.trim()).join(" ").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

/**
 * Parses a PDF buffer via `pdfjs-dist` (`isEvalSupported: false`) and chunks strictly via
 * `packages/core-l0` (`../oa/chunk.js`).
 */
export async function parsePdfDocument(
  bytes: Uint8Array,
  refId = "oa_parse",
  options?: {
    readonly extractPages?: PdfPageExtractorFn;
    readonly applyNeighbourExtension?: boolean;
  }
): Promise<OaParseResponse> {
  const extractor = options?.extractPages ?? extractPdfPagesWithPdfJs;
  const pages = await extractor(bytes);

  const chunked = chunkPdfPages(refId, pages, {
    sourceKind: "FULLTEXT",
    ...(options?.applyNeighbourExtension !== undefined
      ? { applyNeighbourExtension: options.applyNeighbourExtension }
      : {}),
  });

  const page1Text = chunked.pageTexts[0] ?? "";
  const page2Text = chunked.pageTexts[1] ?? "";
  const combined12 = page2Text ? `${page1Text}\n${page2Text}` : page1Text;

  return {
    kind: "PDF",
    units: chunked.units.map((u) => ({ section: u.section, text: u.text })),
    identity: {
      doiOnPage1to2: scanPage1Doi(combined12),
      firstPageTitle: extractFirstPageTitle(pages[0]),
      arxivIdOnPage1: scanPage1ArxivId(page1Text),
      jatsDoi: null,
    },
    hiddenTextDropped: chunked.hiddenTextPages.length,
  };
}
