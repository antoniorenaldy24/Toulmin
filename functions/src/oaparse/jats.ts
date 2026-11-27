import { XMLParser } from "fast-xml-parser";
import type { OaParseResponse } from "@toulmin/schemas";
import { chunkJatsOrderedNodes, type OrderedXmlNode } from "../oa/chunk.js";

export interface ParsedJatsOutput extends OaParseResponse {
  readonly jatsLicense: string | null;
}

const jatsParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

function extractTextFromOrderedNodes(nodes: readonly OrderedXmlNode[]): string {
  const parts: string[] = [];
  const walk = (list: readonly OrderedXmlNode[]): void => {
    for (const node of list) {
      const txt = node["#text"];
      if (typeof txt === "string" || typeof txt === "number" || typeof txt === "boolean") {
        parts.push(String(txt));
        continue;
      }
      for (const [k, v] of Object.entries(node)) {
        if (k === ":@" || k === "#text" || k === "#comment" || k.startsWith("?")) continue;
        if (Array.isArray(v)) {
          walk(v as readonly OrderedXmlNode[]);
        }
      }
    }
  };
  walk(nodes);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function extractJatsLicenseFromNodes(nodes: readonly OrderedXmlNode[]): string | null {
  let found: string | null = null;
  const walk = (list: readonly OrderedXmlNode[]): void => {
    for (const node of list) {
      if (found) return;
      for (const [k, v] of Object.entries(node)) {
        if (k === ":@" || k === "#text" || k === "#comment" || k.startsWith("?")) continue;
        const colon = k.indexOf(":");
        const local = (colon !== -1 ? k.slice(colon + 1) : k).toLowerCase();
        if (local === "license") {
          const attrs = node[":@"];
          const href = attrs?.["@_xlink:href"] ?? attrs?.["@_href"];
          if (typeof href === "string" && href.trim().length > 0) {
            found = href.trim();
            return;
          }
          const licType = attrs?.["@_license-type"];
          if (typeof licType === "string" && licType.trim().length > 0) {
            found = licType.trim();
            return;
          }
          if (Array.isArray(v)) {
            const inner = extractTextFromOrderedNodes(v as readonly OrderedXmlNode[]);
            if (inner.length > 0) {
              found = inner;
              return;
            }
          }
        }
        if (Array.isArray(v)) {
          walk(v as readonly OrderedXmlNode[]);
        }
      }
    }
  };
  walk(nodes);
  return found;
}

/**
 * Parses JATS XML using `fast-xml-parser` (`preserveOrder: true`, `ignoreAttributes: false`)
 * and chunks strictly via `packages/core-l0` (`../oa/chunk.js`, `05` §3.2.4, `06` §5.3 rule 5).
 */
export function parseJatsDocument(
  xmlText: string,
  refId = "oa_parse",
  options?: { readonly applyNeighbourExtension?: boolean }
): ParsedJatsOutput {
  const orderedNodes = jatsParser.parse(xmlText) as OrderedXmlNode[];
  const chunked = chunkJatsOrderedNodes(refId, orderedNodes, {
    sourceKind: "FULLTEXT",
    ...(options?.applyNeighbourExtension !== undefined
      ? { applyNeighbourExtension: options.applyNeighbourExtension }
      : {}),
  });
  const jatsLicense = extractJatsLicenseFromNodes(orderedNodes);

  return {
    kind: "JATS",
    units: chunked.units.map((u) => ({ section: u.section, text: u.text })),
    identity: {
      doiOnPage1to2: null,
      firstPageTitle: null,
      arxivIdOnPage1: null,
      jatsDoi: chunked.doi,
    },
    hiddenTextDropped: 0,
    jatsLicense,
  };
}
