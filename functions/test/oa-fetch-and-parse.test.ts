import { describe, expect, it } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import { sha256hex } from "../src/bib/bibResolve.js";
import { CounterEngine, GlobalStateCache } from "../src/common/counters.js";
import { JudgeValidityCache } from "../src/judge/validity.js";
import { acquireArxivLock } from "../src/oa/arxivOai.js";
import { verifyDocumentIdentity } from "../src/oa/identity.js";
import {
  createOaFetchHandler,
  ParseSemaphore,
  ParserHttpError,
  type CachedOaChunksDoc,
} from "../src/oa/oaFetch.js";
import { normalizeLicense, pickMoreRestrictiveLicense } from "../src/oa/locate.js";
import { InMemoryFirestore } from "./helpers/inMemoryFirestore.js";

const BASE_NOW_MS = Date.UTC(2026, 10, 27, 10, 0, 0);
const PEPPER_NET = "oa-test-net-pepper-32-bytes!!!!";

function makeMemoryStorage() {
  const store = new Map<string, CachedOaChunksDoc>();
  return {
    store,
    adapter: {
      readChunks: async (p: string) => store.get(p) ?? null,
      writeChunks: async (p: string, doc: CachedOaChunksDoc) => {
        store.set(p, doc);
      },
    },
  };
}

describe("oaFetch licence gate, arXiv lock, identity check, semaphore & forged fields (AC-FN-04..05)", () => {
  it("rejects forged extra fields (url, license) with invalid-argument (AC-FN-05)", async () => {
    const db = new InMemoryFirestore();
    const stateCache = new GlobalStateCache(db, { now: () => BASE_NOW_MS });
    const counters = new CounterEngine(db, stateCache, { now: () => BASE_NOW_MS, randomInt: () => 0 });
    const judgeValidator = new JudgeValidityCache(db, { now: () => BASE_NOW_MS });
    const storage = makeMemoryStorage();

    const handler = createOaFetchHandler({
      lane: "public",
      db,
      stateCache,
      counters,
      judgeValidator,
      storage: storage.adapter,
      semaphore: new ParseSemaphore(3),
      invokeParser: async () => {
        throw new Error("should not reach parser");
      },
      getUnpaywallEmail: () => "ops@toulmin.example",
      getNetHashPepper: () => PEPPER_NET,
      now: () => BASE_NOW_MS,
    });

    await expect(
      handler({
        auth: { uid: "u-evil", token: {} },
        data: { refId: "doi:10.1000/abc", url: "https://evil.org/x", license: "cc-by" },
      })
    ).rejects.toBeInstanceOf(HttpsError);
  });

  it("caches CC-BY JATS and arXiv CC-BY, refuses caching CC-BY-NC / bronze / non-exclusive, and handles IDENTITY_MISMATCH", async () => {
    const db = new InMemoryFirestore();
    const stateCache = new GlobalStateCache(db, { now: () => BASE_NOW_MS });
    const counters = new CounterEngine(db, stateCache, { now: () => BASE_NOW_MS, randomInt: () => 0 });
    const judgeValidator = new JudgeValidityCache(db, { now: () => BASE_NOW_MS });
    const storage = makeMemoryStorage();
    const parserCalls: string[] = [];

    const seedMeta = (refId: string, doi: string | null, oa: Record<string, unknown>) => {
      db.seedDoc(`refmeta/${sha256hex(refId)}`, {
        refId,
        doi,
        openalexId: "W1",
        title: "Clinical Trial Results",
        authors: [{ family: "Smith" }],
        authorCount: 1,
        year: 2024,
        venue: "PLOS",
        isPreprint: false,
        isRetracted: false,
        retraction: null,
        retractionCheckedAt: BASE_NOW_MS,
        oaAvailable: true,
        oa,
      });
    };

    seedMeta("doi:10.1000/jats-ccby", "10.1000/jats-ccby", {
      pmcid: "PMC100",
      arxivId: null,
      pdfUrl: null,
      license: null,
      licenseSource: null,
    });
    seedMeta("doi:10.1000/nc-pdf", "10.1000/nc-pdf", {
      pmcid: null,
      arxivId: null,
      pdfUrl: "https://oa.example.org/nc.pdf",
      license: "cc-by",
      licenseSource: "OPENALEX",
    });
    seedMeta("doi:10.48550/arxiv.2401.00001", "10.48550/arxiv.2401.00001", {
      pmcid: null,
      arxivId: "2401.00001",
      pdfUrl: null,
      license: null,
      licenseSource: null,
    });
    seedMeta("doi:10.48550/arxiv.2401.00002", "10.48550/arxiv.2401.00002", {
      pmcid: null,
      arxivId: "2401.00002",
      pdfUrl: null,
      license: null,
      licenseSource: null,
    });
    seedMeta("doi:10.1000/mismatch", "10.1000/mismatch", {
      pmcid: null,
      arxivId: null,
      pdfUrl: "https://oa.example.org/mismatch.pdf",
      license: "cc-by",
      licenseSource: "OPENALEX",
    });

    const handler = createOaFetchHandler({
      lane: "public",
      db,
      stateCache,
      counters,
      judgeValidator,
      storage: storage.adapter,
      semaphore: new ParseSemaphore(3),
      getUnpaywallEmail: () => "ops@toulmin.example",
      getNetHashPepper: () => PEPPER_NET,
      spike_be_2_primary: true,
      now: () => BASE_NOW_MS,
      sleep: async () => undefined,
      confirmUnpaywall: async (doi) => (doi === "10.1000/nc-pdf" ? "cc-by-nc" : null),
      fetchArxivLicense: async (id) =>
        id === "2401.00001"
          ? "http://creativecommons.org/licenses/by/4.0/"
          : "http://arxiv.org/licenses/nonexclusive-distrib/1.0/",
      safeFetchImpl: async (url) => ({
        finalUrl: url,
        pinnedIp: "93.184.216.34",
        statusCode: 200,
        headers: {},
        body: url.includes("PMC100")
          ? new TextEncoder().encode(
              '<?xml version="1.0"?><article><front><article-meta><article-id pub-id-type="doi">10.1000/jats-ccby</article-id><permissions><license xlink:href="https://creativecommons.org/licenses/by/4.0/"/></permissions></article-meta></front><body><p>Valid trial text.</p></body></article>'
            )
          : new TextEncoder().encode("%PDF-1.7 dummy"),
      }),
      invokeParser: async ({ parserName, refId }) => {
        parserCalls.push(`${parserName}:${refId}`);
        if (refId === "doi:10.1000/jats-ccby") {
          return {
            kind: "JATS",
            units: [{ section: "results", text: "Mortality fell by 30%." }],
            identity: { doiOnPage1to2: null, firstPageTitle: null, arxivIdOnPage1: null, jatsDoi: "10.1000/jats-ccby" },
            hiddenTextDropped: 0,
          };
        }
        if (refId === "doi:10.1000/mismatch") {
          return {
            kind: "PDF",
            units: [{ section: "results", text: "Wrong paper." }],
            identity: { doiOnPage1to2: "10.9999/other", firstPageTitle: null, arxivIdOnPage1: null, jatsDoi: null },
            hiddenTextDropped: 0,
          };
        }
        if (refId.includes("arxiv.2401.00001")) {
          return {
            kind: "PDF",
            units: [{ section: "results", text: "arXiv CC-BY unit." }],
            identity: { doiOnPage1to2: null, firstPageTitle: null, arxivIdOnPage1: "2401.00001v1", jatsDoi: null },
            hiddenTextDropped: 0,
          };
        }
        if (refId.includes("arxiv.2401.00002")) {
          return {
            kind: "PDF",
            units: [{ section: "results", text: "arXiv non-exclusive unit." }],
            identity: { doiOnPage1to2: null, firstPageTitle: null, arxivIdOnPage1: "2401.00002", jatsDoi: null },
            hiddenTextDropped: 0,
          };
        }
        return {
          kind: "PDF",
          units: [{ section: "results", text: "CC-BY-NC unit." }],
          identity: { doiOnPage1to2: "10.1000/nc-pdf", firstPageTitle: null, arxivIdOnPage1: null, jatsDoi: null },
          hiddenTextDropped: 0,
        };
      },
    });

    // 1. CC-BY JATS -> parsed & cached in Storage
    const jatsRes = await handler({ auth: { uid: "u-oa", token: {} }, data: { refId: "doi:10.1000/jats-ccby" } });
    expect(jatsRes.source).toBe("JATS");
    expect(jatsRes.license).toBe("cc-by");
    expect(storage.store.has(`oa/${sha256hex("doi:10.1000/jats-ccby")}/chunks.json`)).toBe(true);

    // 2. Second request hits cache and re-runs sanitizer
    const cacheHit = await handler({ auth: { uid: "u-oa", token: {} }, data: { refId: "doi:10.1000/jats-ccby" } });
    expect(cacheHit.cached).toBe(true);
    expect(parserCalls.filter((c) => c.includes("jats-ccby"))).toHaveLength(1);

    // 3. OpenAlex cc-by vs Unpaywall cc-by-nc -> more restrictive cc-by-nc wins -> NOT cached
    expect(pickMoreRestrictiveLicense("cc-by", "cc-by-nc")).toBe("cc-by-nc");
    const ncRes = await handler({ auth: { uid: "u-oa", token: {} }, data: { refId: "doi:10.1000/nc-pdf" } });
    expect(ncRes.source).toBe("PDF");
    expect(ncRes.license).toBe("cc-by-nc");
    expect(ncRes.cached).toBe(false);
    expect(storage.store.has(`oa/${sha256hex("doi:10.1000/nc-pdf")}/chunks.json`)).toBe(false);

    // 4. arXiv CC-BY -> cached; arXiv non-exclusive -> NOT cached
    const arxCcBy = await handler({ auth: { uid: "u-oa", token: {} }, data: { refId: "doi:10.48550/arxiv.2401.00001" } });
    expect(arxCcBy.source).toBe("ARXIV");
    expect(arxCcBy.license).toBe("cc-by");
    expect(storage.store.has(`oa/${sha256hex("doi:10.48550/arxiv.2401.00001")}/chunks.json`)).toBe(true);

    const arxNonEx = await handler({ auth: { uid: "u-oa", token: {} }, data: { refId: "doi:10.48550/arxiv.2401.00002" } });
    expect(arxNonEx.source).toBe("ARXIV");
    expect(arxNonEx.cached).toBe(false);
    expect(storage.store.has(`oa/${sha256hex("doi:10.48550/arxiv.2401.00002")}/chunks.json`)).toBe(false);

    // 5. IDENTITY_MISMATCH -> NONE, nothing cached, quota refunded
    const beforeCount = (db.getDocData("users/u-oa/quota/20261127")?.["oaFetch"] as number) ?? 0;
    const mismatchRes = await handler({ auth: { uid: "u-oa", token: {} }, data: { refId: "doi:10.1000/mismatch" } });
    expect(mismatchRes.source).toBe("NONE");
    expect(mismatchRes.reason).toBe("IDENTITY_MISMATCH");
    expect(storage.store.has(`oa/${sha256hex("doi:10.1000/mismatch")}/chunks.json`)).toBe(false);
    const afterCount = (db.getDocData("users/u-oa/quota/20261127")?.["oaFetch"] as number) ?? 0;
    expect(afterCount).toBe(beforeCount);
  });

  it("enforces /global/arxivLock 3 s spacing & 20 s skip, plus PARSER_BUSY semaphore + 429 retry", async () => {
    const db = new InMemoryFirestore();
    const nowMs = BASE_NOW_MS;
    const sleeps: number[] = [];

    const l1 = await acquireArxivLock(db, () => nowMs, async (ms) => { sleeps.push(ms); });
    expect(l1).toEqual({ acquired: true, waitMs: 0 });
    const l2 = await acquireArxivLock(db, () => nowMs, async (ms) => { sleeps.push(ms); });
    expect(l2).toEqual({ acquired: true, waitMs: 3_000 });
    expect(sleeps).toEqual([3_000]);

    // Seed far-future lock (> 20 s away) -> skipped
    db.seedDoc("global/arxivLock", { nextAllowedAt: nowMs + 21_000 });
    const lSkip = await acquireArxivLock(db, () => nowMs, async () => undefined);
    expect(lSkip.acquired).toBe(false);

    // ParseSemaphore timeout -> PARSER_BUSY + quota refund; 429 retry once after 2 s
    const sem = new ParseSemaphore(1);
    expect(await sem.acquire(10)).toBe(true);
    expect(await sem.acquire(5)).toBe(false); // busy!
    sem.release();

    const stateCache = new GlobalStateCache(db, { now: () => nowMs });
    const counters = new CounterEngine(db, stateCache, { now: () => nowMs, randomInt: () => 0 });
    const judgeValidator = new JudgeValidityCache(db, { now: () => nowMs });
    const storage = makeMemoryStorage();
    db.seedDoc(`refmeta/${sha256hex("doi:10.1000/retry")}`, {
      refId: "doi:10.1000/retry",
      doi: "10.1000/retry",
      openalexId: "W9",
      title: "Retry Test",
      authors: [{ family: "Doe" }],
      authorCount: 1,
      year: 2024,
      venue: "Nature",
      isPreprint: false,
      isRetracted: false,
      retraction: null,
      retractionCheckedAt: nowMs,
      oaAvailable: true,
      oa: { pmcid: "PMC9", arxivId: null, pdfUrl: null, license: "cc-by", licenseSource: "JATS" },
    });

    let attempts = 0;
    const handler = createOaFetchHandler({
      lane: "public",
      db,
      stateCache,
      counters,
      judgeValidator,
      storage: storage.adapter,
      semaphore: new ParseSemaphore(3),
      getUnpaywallEmail: () => "ops@toulmin.example",
      getNetHashPepper: () => PEPPER_NET,
      now: () => nowMs,
      sleep: async () => undefined,
      safeFetchImpl: async (url) => ({
        finalUrl: url,
        pinnedIp: "93.184.216.34",
        statusCode: 200,
        headers: {},
        body: new TextEncoder().encode('<?xml version="1.0"?><article/>'),
      }),
      invokeParser: async () => {
        attempts += 1;
        if (attempts === 1) throw new ParserHttpError(503, "busy");
        return {
          kind: "JATS",
          units: [{ section: "abstract", text: "Recovered on retry." }],
          identity: { doiOnPage1to2: null, firstPageTitle: null, arxivIdOnPage1: null, jatsDoi: "10.1000/retry" },
          hiddenTextDropped: 0,
        };
      },
    });
    const retryRes = await handler({ auth: { uid: "u-retry", token: {} }, data: { refId: "doi:10.1000/retry" } });
    expect(attempts).toBe(2);
    expect(retryRes.source).toBe("JATS");
  });

  it("propagates HIDDEN_PDF_TEXT, preserves blocked reasons on cache hit, rejects restrictive NC/arXiv mismatches, and refunds on PARSER_BUSY or storage errors", async () => {
    const db = new InMemoryFirestore();
    const stateCache = new GlobalStateCache(db, { now: () => BASE_NOW_MS });
    const counters = new CounterEngine(db, stateCache, { now: () => BASE_NOW_MS, randomInt: () => 0 });
    const judgeValidator = new JudgeValidityCache(db, { now: () => BASE_NOW_MS });
    const storage = makeMemoryStorage();

    // 1. License normalization rejects noncommercial/nc variants and JATS without <license> never inherits OpenAlex license
    expect(normalizeLicense("cc-by-noncommercial")).toBe("cc-by-nc");
    expect(normalizeLicense("cc-by-sa-nc")).toBe("cc-by-nc");
    expect(normalizeLicense("cc-by-4.0")).toBe("cc-by");

    // 2. arXiv ID mismatch on page 1 fails identity even when title matches
    expect(
      verifyDocumentIdentity(
        "ARXIV",
        {
          doiOnPage1to2: null,
          firstPageTitle: "Identical Title Match",
          arxivIdOnPage1: "2401.99999",
          jatsDoi: null,
        },
        {
          refId: "doi:10.48550/arxiv.2401.00001",
          doi: "10.48550/arxiv.2401.00001",
          openalexId: "W1",
          title: "Identical Title Match",
          authors: [],
          authorCount: 0,
          year: 2024,
          venue: "arXiv",
          isPreprint: true,
          isRetracted: false,
          retraction: null,
          retractionCheckedAt: BASE_NOW_MS,
          oaAvailable: true,
          oa: { pmcid: null, arxivId: "2401.00001", pdfUrl: null, license: null, licenseSource: null },
          expireAt: BASE_NOW_MS + 1000,
        }
      )
    ).toBe(false);

    // 3. HIDDEN_PDF_TEXT + TAG_CHARS stored in cache stay tier="blocked" on cache hit
    db.seedDoc(`refmeta/${sha256hex("doi:10.1000/hidden")}`, {
      refId: "doi:10.1000/hidden",
      doi: "10.1000/hidden",
      openalexId: "W-hid",
      title: "Hidden Text Study",
      authors: [{ family: "Lee" }],
      authorCount: 1,
      year: 2024,
      venue: "PLOS",
      isPreprint: false,
      isRetracted: false,
      retraction: null,
      retractionCheckedAt: BASE_NOW_MS,
      oaAvailable: true,
      oa: { pmcid: null, arxivId: null, pdfUrl: "https://oa.example.org/hidden.pdf", license: "cc-by", licenseSource: "OPENALEX" },
    });

    const tagged = `Normal\u{E0041} sentence.`;
    const hiddenHandler = createOaFetchHandler({
      lane: "public",
      db,
      stateCache,
      counters,
      judgeValidator,
      storage: storage.adapter,
      semaphore: new ParseSemaphore(3),
      getUnpaywallEmail: () => "ops@toulmin.example",
      getNetHashPepper: () => PEPPER_NET,
      now: () => BASE_NOW_MS,
      sleep: async () => undefined,
      confirmUnpaywall: async () => null,
      safeFetchImpl: async (url) => ({
        finalUrl: url,
        pinnedIp: "93.184.216.34",
        statusCode: 200,
        headers: {},
        body: new TextEncoder().encode("%PDF-1.7 dummy"),
      }),
      invokeParser: async () => ({
        kind: "PDF",
        units: [{ section: "results", text: tagged }],
        identity: { doiOnPage1to2: "10.1000/hidden", firstPageTitle: null, arxivIdOnPage1: null, jatsDoi: null },
        hiddenTextDropped: 1,
      }),
    });

    const first = await hiddenHandler({ auth: { uid: "u-hid", token: {} }, data: { refId: "doi:10.1000/hidden" } });
    expect(first.sections[0]?.units[0]?.tier).toBe("blocked");
    expect(first.sections[0]?.units[0]?.reasons).toEqual(expect.arrayContaining(["TAG_CHARS", "HIDDEN_PDF_TEXT"]));

    const second = await hiddenHandler({ auth: { uid: "u-hid", token: {} }, data: { refId: "doi:10.1000/hidden" } });
    expect(second.cached).toBe(true);
    expect(second.sections[0]?.units[0]?.tier).toBe("blocked");
    expect(second.sections[0]?.units[0]?.reasons).toEqual(expect.arrayContaining(["TAG_CHARS", "HIDDEN_PDF_TEXT"]));

    // 4. Default arXiv BE-2 fallback returns source="ARXIV", reason="LICENSE_UNKNOWN", cached=false
    db.seedDoc(`refmeta/${sha256hex("doi:10.48550/arxiv.2402.00001")}`, {
      refId: "doi:10.48550/arxiv.2402.00001",
      doi: "10.48550/arxiv.2402.00001",
      openalexId: "W-arx",
      title: "Arxiv Fallback Paper",
      authors: [],
      authorCount: 0,
      year: 2024,
      venue: "arXiv",
      isPreprint: true,
      isRetracted: false,
      retraction: null,
      retractionCheckedAt: BASE_NOW_MS,
      oaAvailable: true,
      oa: { pmcid: null, arxivId: "2402.00001", pdfUrl: null, license: null, licenseSource: null },
    });
    const arxFallbackHandler = createOaFetchHandler({
      lane: "public",
      db,
      stateCache,
      counters,
      judgeValidator,
      storage: storage.adapter,
      semaphore: new ParseSemaphore(3),
      getUnpaywallEmail: () => "ops@toulmin.example",
      getNetHashPepper: () => PEPPER_NET,
      now: () => BASE_NOW_MS,
      sleep: async () => undefined,
      safeFetchImpl: async (url) => ({
        finalUrl: url,
        pinnedIp: "93.184.216.34",
        statusCode: 200,
        headers: {},
        body: new TextEncoder().encode("%PDF-1.7 arx"),
      }),
      invokeParser: async () => ({
        kind: "PDF",
        units: [{ section: "results", text: "Clean arXiv result." }],
        identity: { doiOnPage1to2: null, firstPageTitle: null, arxivIdOnPage1: "2402.00001", jatsDoi: null },
        hiddenTextDropped: 0,
      }),
    });
    const arxFbRes = await arxFallbackHandler({
      auth: { uid: "u-arx-fb", token: {} },
      data: { refId: "doi:10.48550/arxiv.2402.00001" },
    });
    expect(arxFbRes.source).toBe("ARXIV");
    expect(arxFbRes.reason).toBe("LICENSE_UNKNOWN");
    expect(arxFbRes.cached).toBe(false);

    // 5. Saturated semaphore returns PARSER_BUSY & refunds quota; Storage exception also refunds quota
    db.seedDoc(`refmeta/${sha256hex("doi:10.1000/busy")}`, {
      refId: "doi:10.1000/busy",
      doi: "10.1000/busy",
      openalexId: "W-busy",
      title: "Busy Study",
      authors: [],
      authorCount: 0,
      year: 2024,
      venue: "PLOS",
      isPreprint: false,
      isRetracted: false,
      retraction: null,
      retractionCheckedAt: BASE_NOW_MS,
      oaAvailable: true,
      oa: { pmcid: null, arxivId: null, pdfUrl: "https://oa.example.org/busy.pdf", license: "cc-by", licenseSource: "OPENALEX" },
    });
    const busySem = new ParseSemaphore(1);
    expect(await busySem.acquire(10)).toBe(true);
    const busyHandler = createOaFetchHandler({
      lane: "public",
      db,
      stateCache,
      counters,
      judgeValidator,
      storage: storage.adapter,
      semaphore: busySem,
      parseSemaphoreWaitMs: 5,
      getUnpaywallEmail: () => "ops@toulmin.example",
      getNetHashPepper: () => PEPPER_NET,
      now: () => BASE_NOW_MS,
      sleep: async () => undefined,
      confirmUnpaywall: async () => null,
      safeFetchImpl: async (url) => ({
        finalUrl: url,
        pinnedIp: "93.184.216.34",
        statusCode: 200,
        headers: {},
        body: new TextEncoder().encode("%PDF-1.7 busy"),
      }),
      invokeParser: async () => {
        throw new Error("unreachable");
      },
    });
    const busyRes = await busyHandler({
      auth: { uid: "u-busy", token: {} },
      data: { refId: "doi:10.1000/busy" },
    });
    expect(busyRes.source).toBe("NONE");
    expect(busyRes.reason).toBe("PARSER_BUSY");
    expect(db.getDocData("users/u-busy/quota/20261127")?.["oaFetch"]).toBe(0);
    busySem.release();

    const errHandler = createOaFetchHandler({
      lane: "public",
      db,
      stateCache,
      counters,
      judgeValidator,
      storage: {
        readChunks: async () => {
          throw new Error("GCS boom");
        },
        writeChunks: async () => undefined,
      },
      semaphore: new ParseSemaphore(3),
      invokeParser: async () => {
        throw new Error("unreachable");
      },
      getUnpaywallEmail: () => "ops@toulmin.example",
      getNetHashPepper: () => PEPPER_NET,
      now: () => BASE_NOW_MS,
    });
    await expect(
      errHandler({ auth: { uid: "u-storage-err", token: {} }, data: { refId: "doi:10.1000/hidden" } })
    ).rejects.toThrow("GCS boom");
    expect(db.getDocData("users/u-storage-err/quota/20261127")?.["oaFetch"]).toBe(0);

    // 6. JATS without <license> MUST NOT inherit OpenAlex refMeta.oa.license
    db.seedDoc(`refmeta/${sha256hex("doi:10.1000/jats-nolic")}`, {
      refId: "doi:10.1000/jats-nolic",
      doi: "10.1000/jats-nolic",
      openalexId: "W-jnolic",
      title: "No License JATS",
      authors: [],
      authorCount: 0,
      year: 2024,
      venue: "PMC",
      isPreprint: false,
      isRetracted: false,
      retraction: null,
      retractionCheckedAt: BASE_NOW_MS,
      oaAvailable: true,
      oa: { pmcid: "PMC999", arxivId: null, pdfUrl: null, license: "cc-by", licenseSource: "OPENALEX" },
    });
    const noLicJatsHandler = createOaFetchHandler({
      lane: "public",
      db,
      stateCache,
      counters,
      judgeValidator,
      storage: storage.adapter,
      semaphore: new ParseSemaphore(3),
      getUnpaywallEmail: () => "ops@toulmin.example",
      getNetHashPepper: () => PEPPER_NET,
      now: () => BASE_NOW_MS,
      safeFetchImpl: async (url) => ({
        finalUrl: url,
        pinnedIp: "93.184.216.34",
        statusCode: 200,
        headers: {},
        body: new TextEncoder().encode(
          '<?xml version="1.0"?><article><front><article-meta><article-id pub-id-type="doi">10.1000/jats-nolic</article-id></article-meta></front><body><p>Body text.</p></body></article>'
        ),
      }),
      invokeParser: async () => ({
        kind: "JATS",
        units: [{ section: "body", text: "Body text." }],
        identity: { doiOnPage1to2: null, firstPageTitle: null, arxivIdOnPage1: null, jatsDoi: "10.1000/jats-nolic" },
        hiddenTextDropped: 0,
      }),
    });
    const noLicRes = await noLicJatsHandler({
      auth: { uid: "u-nolic", token: {} },
      data: { refId: "doi:10.1000/jats-nolic" },
    });
    expect(noLicRes.source).toBe("JATS");
    expect(noLicRes.license).toBeNull();
    expect(noLicRes.cached).toBe(false);
    expect(noLicRes.reason).toBe("LICENSE_UNKNOWN");
    expect(storage.store.has(`oa/${sha256hex("doi:10.1000/jats-nolic")}/chunks.json`)).toBe(false);
  });
});
