import { XMLParser } from "fast-xml-parser";
import type { FirestoreLike } from "../common/counters.js";
import { safeFetch, type SafeFetchOptions } from "../net/safeFetch.js";
import type { OrderedXmlNode } from "./chunk.js";

const ARXIV_LOCK_INTERVAL_MS = 3_000;
const ARXIV_LOCK_MAX_WAIT_MS = 20_000;

export interface ArxivLockResult {
  readonly acquired: boolean;
  readonly waitMs: number;
}

/**
 * Serializes all arXiv requests across all Cloud Function instances through `/global/arxivLock`
 * (`05` §3.2.2 step 3): reserves `nextAllowedAt = max(now, prev) + 3 s`.
 * If waiting would exceed 20 s, skips arXiv for this call (`acquired: false`).
 */
export async function acquireArxivLock(
  db: FirestoreLike,
  now: () => number = () => Date.now(),
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
): Promise<ArxivLockResult> {
  const lockRef = db.doc("global/arxivLock");

  const { acquired, waitMs } = await db.runTransaction(async (tx) => {
    const currentNow = now();
    const snap = await tx.get(lockRef);
    const prevAllowedRaw = snap.exists ? snap.get("nextAllowedAt") : undefined;
    const prevAllowed =
      typeof prevAllowedRaw === "number" && Number.isFinite(prevAllowedRaw) ? prevAllowedRaw : 0;

    const scheduledAt = Math.max(currentNow, prevAllowed);
    const neededWaitMs = Math.max(0, scheduledAt - currentNow);
    if (neededWaitMs > ARXIV_LOCK_MAX_WAIT_MS) {
      return { acquired: false, waitMs: neededWaitMs };
    }

    tx.set(lockRef, { nextAllowedAt: scheduledAt + ARXIV_LOCK_INTERVAL_MS }, { merge: true });
    return { acquired: true, waitMs: neededWaitMs };
  });

  if (!acquired) {
    return { acquired: false, waitMs };
  }
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  return { acquired: true, waitMs };
}

const xmlParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

function findLicenseTextInNodes(nodes: readonly OrderedXmlNode[]): string | null {
  for (const node of nodes) {
    for (const [k, v] of Object.entries(node)) {
      if (k === ":@" || k === "#text" || k === "#comment" || k.startsWith("?")) continue;
      const colon = k.indexOf(":");
      const local = (colon !== -1 ? k.slice(colon + 1) : k).toLowerCase();
      if (local === "license" && Array.isArray(v)) {
        const parts: string[] = [];
        for (const child of v as readonly OrderedXmlNode[]) {
          if (typeof child["#text"] === "string") parts.push(child["#text"]);
        }
        const text = parts.join("").trim();
        if (text.length > 0) return text;
      }
      if (Array.isArray(v)) {
        const nested = findLicenseTextInNodes(v as readonly OrderedXmlNode[]);
        if (nested) return nested;
      }
    }
  }
  return null;
}

export function parseArxivRawLicenseXml(xmlText: string): string | null {
  const nodes = xmlParser.parse(xmlText) as OrderedXmlNode[];
  return findLicenseTextInNodes(nodes);
}

/**
 * Fetches an arXiv paper's `<license>` via OAI-PMH `arXivRaw` (`05` §3.2.2 step 3, `BE-2`).
 */
export async function fetchArxivOaiLicense(
  arxivId: string,
  safeFetchOpts: SafeFetchOptions
): Promise<string | null> {
  const url = `https://oaipmh.arxiv.org/oai?verb=GetRecord&identifier=oai:arXiv.org:${encodeURIComponent(arxivId)}&metadataPrefix=arXivRaw`;
  const resp = await safeFetch(url, {
    ...safeFetchOpts,
    accept: "application/xml, text/xml",
  });
  const xmlText = new TextDecoder("utf-8").decode(resp.body);
  return parseArxivRawLicenseXml(xmlText);
}
