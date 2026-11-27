import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  createBibResolveHandler,
  createDefaultBibRateBuckets,
  createStorageRwLookup,
  resolveSingleRefMetaInternal,
  sha256hex,
} from "../src/bib/bibResolve.js";
import { computeMetadataMismatch, titleSim } from "../src/bib/mismatch.js";
import type { UpstreamFetchFn } from "../src/bib/openalex.js";
import { CounterEngine, GlobalStateCache } from "../src/common/counters.js";
import { createSafeLogger, type SafeLogRecord } from "../src/common/log.js";
import { JudgeValidityCache, hmacHex } from "../src/judge/validity.js";
import { InMemoryFirestore } from "./helpers/inMemoryFirestore.js";

const BASE_NOW_MS = Date.UTC(2026, 10, 27, 10, 0, 0);
const PEPPER_NET = "bib-test-net-pepper-32-bytes!!!";
const PEPPER_CODE = "bib-test-code-pepper-32-bytes!!";

function makeJsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

describe("bibResolve 3-API cascade, mismatch, retraction freshness & safety (AC-FN-01..03, AC-FN-09..10)", () => {
  it("resolves DOIs via OpenAlex, Semantic Scholar gap-fill, Crossref raw/retraction, and SICI DOI singleton", async () => {
    const db = new InMemoryFirestore();
    const stateCache = new GlobalStateCache(db, { now: () => BASE_NOW_MS });
    const counters = new CounterEngine(db, stateCache, { now: () => BASE_NOW_MS, randomInt: () => 0 });
    const judgeValidator = new JudgeValidityCache(db, { now: () => BASE_NOW_MS });
    const logs: SafeLogRecord[] = [];
    const calledUrls: string[] = [];

    const siciDoi = "10.1002/(sici)1097-0142(1996)77:1<10::aid-cncr3>3.0.co;2-p";
    const specialSepDoi = "10.1000/special,doi|with&chars";
    const specialSepEncoded = encodeURIComponent(specialSepDoi);

    const fetchFn: UpstreamFetchFn = async (url, init) => {
      calledUrls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.startsWith(`https://api.openalex.org/works/doi:${specialSepEncoded}`)) {
        return makeJsonResponse(200, {
          id: "https://openalex.org/W888888",
          doi: `https://doi.org/${specialSepDoi}`,
          display_name: "Special Separator DOI Study",
          publication_year: 2021,
          authorships: [{ author: { display_name: "Dan Kim" } }],
          primary_location: { source: { display_name: "JAMA" } },
          best_oa_location: null,
          open_access: { is_oa: false },
          abstract_inverted_index: { Special: [0], separator: [1], study: [2] },
          is_retracted: false,
          ids: {},
          type: "article",
        });
      }
      if (url.startsWith("https://api.openalex.org/works?filter=doi:")) {
        return makeJsonResponse(200, {
          results: [
            {
              id: "https://openalex.org/W111",
              doi: "https://doi.org/10.1000/oa1",
              display_name: "Effects of Drug X: A Randomized Trial",
              publication_year: 2022,
              authorships: [{ author: { display_name: "Jane van der Berg" } }],
              primary_location: { source: { display_name: "NEJM" } },
              best_oa_location: { pdf_url: "https://oa.example.org/1.pdf", license: "cc-by" },
              open_access: { is_oa: true },
              abstract_inverted_index: { Drug: [0], X: [1], worked: [2] },
              is_retracted: false,
              ids: { pmcid: "PMC123456" },
              type: "article",
            },
            {
              id: "https://openalex.org/W222",
              doi: "https://doi.org/10.1000/s2gap",
              display_name: "Missing Abstract Filled by S2",
              publication_year: 2023,
              authorships: [{ author: { display_name: "Bob Lee" } }],
              primary_location: { source: { display_name: "Lancet" } },
              best_oa_location: null,
              open_access: { is_oa: false },
              abstract_inverted_index: null,
              is_retracted: false,
              ids: {},
              type: "article",
            },
            {
              id: "https://openalex.org/W999999",
              doi: `https://doi.org/${siciDoi}`,
              display_name: "SICI Cancer Study",
              publication_year: 1996,
              authorships: [{ author: { display_name: "Alice Smith" } }],
              primary_location: { source: { display_name: "Cancer" } },
              best_oa_location: null,
              open_access: { is_oa: false },
              abstract_inverted_index: { SICI: [0], study: [1], abstract: [2] },
              is_retracted: false,
              ids: {},
              type: "article",
            },
          ],
        });
      }
      if (url.startsWith("https://api.semanticscholar.org/graph/v1/paper/batch")) {
        return makeJsonResponse(200, [
          {
            paperId: "s2-222",
            title: "Missing Abstract Filled by S2",
            abstract: "Semantic Scholar abstract text.",
            year: 2023,
            authors: [{ name: "Bob Lee" }],
            externalIds: { DOI: "10.1000/s2gap" },
            isOpenAccess: false,
            openAccessPdf: null,
            journal: { name: "Lancet" },
          },
        ]);
      }
      if (url.startsWith("https://api.crossref.org/works/10.1000%2Foa1")) {
        return makeJsonResponse(404, {});
      }
      if (url.startsWith("https://api.crossref.org/works/10.1000%2Fs2gap")) {
        return makeJsonResponse(404, {});
      }
      if (url.startsWith("https://api.crossref.org/works?query.bibliographic=")) {
        return makeJsonResponse(200, {
          message: {
            items: [
              {
                DOI: "10.1000/cr-raw",
                title: ["Raw Crossref Matched Study"],
                author: [{ family: "Jones", given: "Cara" }],
                "published-print": { "date-parts": [[2021]] },
                "container-title": ["BMJ"],
                abstract: "<jats:p>Cleaned &amp; stripped JATS abstract.</jats:p>",
                score: 85,
              },
            ],
          },
        });
      }
      if (url.startsWith("https://doi.org/api/handles/10.9999%2Fmissing")) {
        return makeJsonResponse(200, { responseCode: 100 });
      }
      if (url.startsWith("https://doi.org/api/handles/10.9999%2Funindexed")) {
        return makeJsonResponse(200, { responseCode: 200 });
      }
      return makeJsonResponse(404, {});
    };

    const handler = createBibResolveHandler({
      lane: "public",
      db,
      stateCache,
      counters,
      judgeValidator,
      getOpenAlexApiKey: () => "oa-secret",
      getS2ApiKey: () => "s2-secret",
      getCrossrefMailto: () => "ops@toulmin.example",
      getNetHashPepper: () => PEPPER_NET,
      spike_be_2_primary: true,
      spike_be_4_primary: true,
      fetchFn,
      buckets: createDefaultBibRateBuckets(() => BASE_NOW_MS, async () => undefined),
      now: () => BASE_NOW_MS,
      logger: createSafeLogger((r) => logs.push(r)),
    });

    const res = await handler({
      auth: { uid: "u-bib-1", token: {} },
      rawRequest: { headers: { "x-forwarded-for": "198.51.100.10" } },
      data: {
        items: [
          {
            key: "k1",
            doi: "10.1000/oa1",
            title: "Effects of Drug X",
            authors: ["van der Berg, Jane"],
            year: 2022,
          },
          { key: "k2", doi: "10.1000/s2gap" },
          { key: "k3", doi: siciDoi },
          { key: "k3b", doi: specialSepDoi },
          { key: "k4", raw: 'Jones C. "Raw Crossref Matched Study." BMJ 2021.' },
          { key: "k5", doi: "10.9999/missing" },
          { key: "k6", doi: "10.9999/unindexed" },
          { key: "k7", title: "Local Grey Literature Report" },
        ],
      },
    });

    const byKey = new Map(res.results.map((r) => [r.key, r]));
    // Subtitle difference + particle surname match -> RESOLVED (no mismatch!)
    expect(byKey.get("k1")?.status).toBe("RESOLVED");
    expect(byKey.get("k1")?.abstract).toBe("Drug X worked");
    expect(byKey.get("k1")?.abstractSource).toBe("OPENALEX");
    expect(byKey.get("k1")?.oaAvailable).toBe(true);

    // S2 gap fill
    expect(byKey.get("k2")?.status).toBe("RESOLVED");
    expect(byKey.get("k2")?.abstract).toBe("Semantic Scholar abstract text.");
    expect(byKey.get("k2")?.abstractSource).toBe("S2");

    // SICI DOI resolved verbatim & special-separator DOI (|, ,, &) queried singly (not in OR-filter)
    expect(byKey.get("k3")?.status).toBe("RESOLVED");
    expect(byKey.get("k3")?.doi).toBe(siciDoi);
    expect(byKey.get("k3b")?.status).toBe("RESOLVED");
    expect(calledUrls.some((u) => u.includes(`/works/doi:${specialSepEncoded}`))).toBe(true);
    expect(calledUrls.some((u) => u.includes("filter=doi:") && u.includes(specialSepEncoded))).toBe(false);

    // Crossref bibliographic query + JATS stripped
    expect(byKey.get("k4")?.status).toBe("RESOLVED");
    expect(byKey.get("k4")?.abstract).toBe("Cleaned & stripped JATS abstract.");
    expect(byKey.get("k4")?.abstractSource).toBe("CROSSREF");

    // doi.org handle codes 100 -> DOI_NOT_FOUND, 200 -> NOT_INDEXED, no-DOI -> NOT_INDEXED
    expect(byKey.get("k5")?.status).toBe("DOI_NOT_FOUND");
    expect(byKey.get("k6")?.status).toBe("NOT_INDEXED");
    expect(byKey.get("k7")?.status).toBe("NOT_INDEXED");

    // AC-FN-03: Zero abstracts persisted in Firestore /refmeta!
    const refmetaDocs = db.listDocs("refmeta/");
    expect(refmetaDocs.length).toBeGreaterThan(0);
    for (const d of refmetaDocs) {
      expect(d.data["abstract"]).toBeUndefined();
      expect(d.data["abstractSource"]).toBeUndefined();
    }

    // AC-FN-10: Zero sensitive titles/raw refs/abstracts in logs
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain("Effects of Drug X");
    expect(serializedLogs).not.toContain("Semantic Scholar abstract text");
    expect(serializedLogs).not.toContain("Raw Crossref Matched Study");
  });

  it("applies tolerant metadata mismatch rules (AC-FN-02)", () => {
    expect(titleSim("Drug X Efficacy: A Systematic Review", "Drug X Efficacy")).toBe(1);
    expect(
      computeMetadataMismatch(
        {
          title: "Completely Unrelated Cardiology Study",
          authors: ["RECOVERY Collaborative Group"],
          year: 2020,
        },
        {
          title: "Orthopedic Knee Arthroplasty Outcomes",
          firstAuthor: { family: "Horby", given: "Peter" },
          year: 2023,
          isPreprint: true,
        }
      )
    ).toEqual(["TITLE"]); // Year tolerated for preprint, consortium tolerated for author
  });

  it("re-checks retraction after > 7 days and skips upstream on 6-day cache hit (AC-FN-09)", async () => {
    const db = new InMemoryFirestore();
    const stateCache = new GlobalStateCache(db, { now: () => BASE_NOW_MS });
    const counters = new CounterEngine(db, stateCache, { now: () => BASE_NOW_MS, randomInt: () => 0 });
    const judgeValidator = new JudgeValidityCache(db, { now: () => BASE_NOW_MS });

    const sixDayRefId = "doi:10.1000/fresh6d";
    const eightDayRefId = "doi:10.1000/stale8d";

    db.seedDoc(`refmeta/${sha256hex(sixDayRefId)}`, {
      refId: sixDayRefId,
      doi: "10.1000/fresh6d",
      openalexId: "W1",
      title: "Fresh Paper",
      authors: [{ family: "Lee" }],
      authorCount: 1,
      year: 2024,
      venue: "Nature",
      isPreprint: false,
      isRetracted: false,
      retraction: null,
      retractionCheckedAt: BASE_NOW_MS - 6 * 86_400_000,
      oaAvailable: false,
      oa: { pmcid: null, arxivId: null, pdfUrl: null, license: null, licenseSource: null },
      expireAt: new Date(BASE_NOW_MS + 20 * 86_400_000),
    });

    db.seedDoc(`refmeta/${sha256hex(eightDayRefId)}`, {
      refId: eightDayRefId,
      doi: "10.1000/stale8d",
      openalexId: "W2",
      title: "Stale Retracted Paper",
      authors: [{ family: "Kim" }],
      authorCount: 1,
      year: 2024,
      venue: "Science",
      isPreprint: false,
      isRetracted: false,
      retraction: null,
      retractionCheckedAt: BASE_NOW_MS - 8 * 86_400_000,
      oaAvailable: false,
      oa: { pmcid: null, arxivId: null, pdfUrl: null, license: null, licenseSource: null },
      expireAt: new Date(BASE_NOW_MS + 20 * 86_400_000),
    });

    let upstreamCalls = 0;
    const handler = createBibResolveHandler({
      lane: "public",
      db,
      stateCache,
      counters,
      judgeValidator,
      getOpenAlexApiKey: () => "k",
      getS2ApiKey: () => "k",
      getCrossrefMailto: () => "m",
      getNetHashPepper: () => PEPPER_NET,
      fetchFn: async () => {
        upstreamCalls += 1;
        return makeJsonResponse(404, {});
      },
      lookupRwRetraction: async (doi) =>
        doi === "10.1000/stale8d" ? { nature: "Retraction", date: "2026-11-20" } : null,
      now: () => BASE_NOW_MS,
    });

    // 6-day hit -> zero upstream calls
    const res6 = await handler({
      auth: { uid: "u-fresh", token: {} },
      data: { items: [{ key: "f", doi: "10.1000/fresh6d" }] },
    });
    expect(res6.results[0]?.isRetracted).toBe(false);
    expect(upstreamCalls).toBe(0);

    // 8-day hit -> re-checks retraction and returns RW_SNAPSHOT retraction
    const res8 = await handler({
      auth: { uid: "u-stale", token: {} },
      data: { items: [{ key: "s", doi: "10.1000/stale8d" }] },
    });
    expect(res8.results[0]?.isRetracted).toBe(true);
    expect(res8.results[0]?.retraction?.source).toBe("RW_SNAPSHOT");
    expect(upstreamCalls).toBeGreaterThan(0);
  });

  it("refunds transient 429/503 items and enforces public vs judge lane isolation", async () => {
    const db = new InMemoryFirestore();
    const stateCache = new GlobalStateCache(db, { now: () => BASE_NOW_MS });
    const counters = new CounterEngine(db, stateCache, { now: () => BASE_NOW_MS, randomInt: () => 0 });
    const judgeValidator = new JudgeValidityCache(db, { now: () => BASE_NOW_MS });

    const codeId = hmacHex(PEPPER_CODE, "TLMN23456789");
    db.seedDoc(`judgeCodes/${codeId}`, {
      uids: ["judge-1"],
      maxUids: 5,
      exp: Math.floor(BASE_NOW_MS / 1000) + 3600,
      disabled: false,
    });

    const publicHandler = createBibResolveHandler({
      lane: "public",
      db,
      stateCache,
      counters,
      judgeValidator,
      getOpenAlexApiKey: () => "k",
      getS2ApiKey: () => "k",
      getCrossrefMailto: () => "m",
      getNetHashPepper: () => PEPPER_NET,
      fetchFn: async () => makeJsonResponse(503, {}),
      now: () => BASE_NOW_MS,
    });

    // Transient 503 returns UPSTREAM_UNAVAILABLE and refunds quota (used drops back to 0)
    const transient = await publicHandler({
      auth: { uid: "anon-refund", token: {} },
      data: { items: [{ key: "t1", doi: "10.1000/down" }] },
    });
    expect(transient.results[0]?.status).toBe("UPSTREAM_UNAVAILABLE");
    const quotaDoc = db.getDocData("users/anon-refund/quota/20261127");
    expect(quotaDoc?.["bibResolve"]).toBe(0);

    // Judge on public lane -> USE_JUDGE_LANE
    await expect(
      publicHandler({
        auth: {
          uid: "judge-1",
          token: {
            tier: "judge",
            codeId: codeId.slice(0, 32),
            tierExp: Math.floor(BASE_NOW_MS / 1000) + 3600,
          },
        },
        data: { items: [{ key: "j", doi: "10.1000/x" }] },
      })
    ).rejects.toMatchObject({ code: "failed-precondition", message: "USE_JUDGE_LANE" });
  });

  it("uses BE-4 manual-redirect HEAD fallback by default, prioritizes 429 RATE_LIMITED over 503, loads RW snapshot via stateCache, and resolves internal refmeta without quota charge", async () => {
    const db = new InMemoryFirestore();
    db.seedDoc("global/state", {
      hardStop: false,
      killSwitch: false,
      rwLatest: "rw/snapshot-20261127.json.gz",
    });
    const stateCache = new GlobalStateCache(db, { now: () => BASE_NOW_MS });
    const counters = new CounterEngine(db, stateCache, { now: () => BASE_NOW_MS, randomInt: () => 0 });
    const judgeValidator = new JudgeValidityCache(db, { now: () => BASE_NOW_MS });

    const rwGz = gzipSync(
      Buffer.from(
        JSON.stringify({
          "10.1000/rwretracted": { nature: "Retraction", date: "2026-11-01", noticeDoi: "10.1000/notice" },
        }),
        "utf8"
      )
    );
    const rwLookup = createStorageRwLookup(stateCache, async (p) => {
      if (p === "rw/snapshot-20261127.json.gz") return rwGz;
      throw new Error("missing");
    });

    const seenInits: Array<{ url: string; method?: string; redirect?: string }> = [];
    const fetchFn: UpstreamFetchFn = async (url, init) => {
      seenInits.push({
        url,
        ...(init?.method ? { method: init.method } : {}),
        ...(init?.redirect ? { redirect: init.redirect } : {}),
      });
      if (url.startsWith("https://doi.org/10.1000%2Fhead404")) {
        return makeJsonResponse(404, {});
      }
      if (url.startsWith("https://doi.org/10.1000%2Fhead302")) {
        return makeJsonResponse(302, {});
      }
      if (url.startsWith("https://api.openalex.org/works/doi:10.1000%2Frwretracted")) {
        return makeJsonResponse(200, {
          id: "https://openalex.org/W555",
          doi: "https://doi.org/10.1000/rwretracted",
          display_name: "Retracted Via Snapshot",
          publication_year: 2024,
          authorships: [],
          is_retracted: false,
          ids: {},
          type: "article",
        });
      }
      if (url.startsWith("https://api.openalex.org/works/doi:10.1000%2Fmixed429")) {
        return makeJsonResponse(503, {});
      }
      if (url.startsWith("https://api.semanticscholar.org/")) {
        if (typeof init?.body === "string" && init.body.includes("10.1000/mixed429")) {
          return makeJsonResponse(429, {});
        }
        return makeJsonResponse(200, []);
      }
      if (url.startsWith("https://api.openalex.org/works/W777?")) {
        expect(url).not.toContain("api_key=");
        return makeJsonResponse(200, {
          id: "https://openalex.org/W777",
          doi: null,
          display_name: "OpenAlex Work Only",
          publication_year: 2025,
          authorships: [{ author: { display_name: "Ada Lovelace" } }],
          best_oa_location: { pdf_url: "https://oa.example.org/w777.pdf", license: "cc-by" },
          open_access: { is_oa: true },
          is_retracted: false,
          ids: {},
          type: "article",
        });
      }
      return makeJsonResponse(404, {});
    };

    const handler = createBibResolveHandler({
      lane: "public",
      db,
      stateCache,
      counters,
      judgeValidator,
      getOpenAlexApiKey: () => "",
      getS2ApiKey: () => "k",
      getCrossrefMailto: () => "ops@toulmin.example",
      getNetHashPepper: () => PEPPER_NET,
      fetchFn,
      lookupRwRetraction: rwLookup,
      buckets: createDefaultBibRateBuckets(() => BASE_NOW_MS, async () => undefined),
      now: () => BASE_NOW_MS,
    });

    const res = await handler({
      auth: { uid: "u-be4", token: {} },
      data: {
        items: [
          { key: "r404", doi: "10.1000/head404" },
          { key: "r302", doi: "10.1000/head302" },
          { key: "rw", doi: "10.1000/rwretracted" },
        ],
      },
    });
    const byKey = new Map(res.results.map((r) => [r.key, r]));
    expect(byKey.get("r404")?.status).toBe("DOI_NOT_FOUND");
    expect(byKey.get("r302")?.status).toBe("NOT_INDEXED");
    expect(byKey.get("rw")?.isRetracted).toBe(true);
    expect(byKey.get("rw")?.retraction?.source).toBe("RW_SNAPSHOT");
    expect(seenInits.some((s) => s.method === "HEAD" && s.redirect === "manual")).toBe(true);
    expect(seenInits.every((s) => !s.url.includes("api_key="))).toBe(true);

    // OpenAlex 503 + S2 429 -> RATE_LIMITED takes precedence
    const res429 = await handler({
      auth: { uid: "u-be4-429", token: {} },
      data: {
        items: [{ key: "m429", doi: "10.1000/mixed429" }],
      },
    });
    expect(res429.results[0]?.status).toBe("RATE_LIMITED");

    // Internal oa:W777 resolution succeeds without touching caller bibResolve quota
    const oaMeta = await resolveSingleRefMetaInternal("oa:W777", {
      db,
      stateCache,
      crossrefMailto: "ops@toulmin.example",
      fetchFn,
      buckets: createDefaultBibRateBuckets(() => BASE_NOW_MS, async () => undefined),
      lookupRwRetraction: rwLookup,
      now: () => BASE_NOW_MS,
    });
    expect(oaMeta?.refId).toBe("oa:W777");
    expect(oaMeta?.oa.pdfUrl).toBe("https://oa.example.org/w777.pdf");
    expect(db.getDocData("users/u-be4/quota/20261127")?.["bibResolve"]).toBe(3);

    // Stale 8-day cache hit does NOT advance retractionCheckedAt when all upstreams fail & RW is null
    const staleRefId = "doi:10.1000/alwaysdown";
    const originalCheckedAt = BASE_NOW_MS - 8 * 86_400_000;
    db.seedDoc(`refmeta/${sha256hex(staleRefId)}`, {
      refId: staleRefId,
      doi: "10.1000/alwaysdown",
      openalexId: "W9",
      title: "Down Ref",
      authors: [],
      authorCount: 0,
      year: 2024,
      venue: null,
      isPreprint: false,
      isRetracted: false,
      retraction: null,
      retractionCheckedAt: originalCheckedAt,
      oaAvailable: false,
      oa: { pmcid: null, arxivId: null, pdfUrl: null, license: null, licenseSource: null },
      expireAt: new Date(BASE_NOW_MS + 10 * 86_400_000),
    });
    const downHandler = createBibResolveHandler({
      lane: "public",
      db,
      stateCache,
      counters,
      judgeValidator,
      getOpenAlexApiKey: () => "",
      getS2ApiKey: () => "",
      getCrossrefMailto: () => "ops@toulmin.example",
      getNetHashPepper: () => PEPPER_NET,
      fetchFn: async () => makeJsonResponse(503, {}),
      lookupRwRetraction: async () => null,
      now: () => BASE_NOW_MS,
    });
    await downHandler({
      auth: { uid: "u-down-check", token: {} },
      data: { items: [{ key: "d", doi: "10.1000/alwaysdown" }] },
    });
    expect(db.getDocData(`refmeta/${sha256hex(staleRefId)}`)?.["retractionCheckedAt"]).toBe(
      originalCheckedAt
    );
  });
});
