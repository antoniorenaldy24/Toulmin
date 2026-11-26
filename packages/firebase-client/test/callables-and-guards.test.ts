import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { HttpsCallableOptions } from "firebase/functions";
import {
  callBibResolve,
  callOaFetch,
  callQuotaGuard,
  callRedeemJudgeCode,
  createBibResolveDoiResolver,
  type HttpsCallableFactory,
} from "../src/index.js";
import { createOfflineRuntimeHarness } from "./helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_ROOT = resolve(__dirname, "..", "src");

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("Typed Callables, App Check token scoping & static security hygiene", () => {
  it("routes bibResolve and oaFetch by judge claim and never passes limitedUseAppCheckTokens", async () => {
    const calls: Array<{ readonly name: string; readonly options: HttpsCallableOptions | undefined }> = [];
    const makeFactory = (payload: unknown): HttpsCallableFactory =>
      ((_fn, name, options) => {
        calls.push({ name, options });
        return (async () => ({ data: payload })) as never;
      }) as HttpsCallableFactory;

    const anonHarness = createOfflineRuntimeHarness({
      runtimeOptions: { isJudgeOverride: () => false },
    });
    const judgeHarness = createOfflineRuntimeHarness({
      runtimeOptions: { isJudgeOverride: () => true },
    });

    await callBibResolve(
      { items: [{ key: "k1", doi: "10.1234/abc" }] },
      { runtime: anonHarness.runtime, httpsCallable: makeFactory({ results: [] }) }
    );
    await callBibResolve(
      { items: [{ key: "k1", doi: "10.1234/abc" }] },
      { runtime: judgeHarness.runtime, httpsCallable: makeFactory({ results: [] }) }
    );
    await callOaFetch(
      { refId: "doi:10.1234/abc" },
      { runtime: anonHarness.runtime, httpsCallable: makeFactory({ refId: "doi:10.1234/abc", source: "NONE", license: null, cached: false, sections: [], fetchedAt: 1 }) }
    );
    await callOaFetch(
      { refId: "doi:10.1234/abc" },
      { runtime: judgeHarness.runtime, httpsCallable: makeFactory({ refId: "doi:10.1234/abc", source: "NONE", license: null, cached: false, sections: [], fetchedAt: 1 }) }
    );

    expect(calls).toEqual([
      { name: "bibResolve", options: undefined },
      { name: "bibResolveJudge", options: undefined },
      { name: "oaFetch", options: undefined },
      { name: "oaFetchJudge", options: undefined },
    ]);

    // Strict input validation rejects forged extra fields on oaFetch.
    await expect(
      callOaFetch(
        { refId: "doi:10.1234/abc", url: "https://evil.example" } as never,
        { runtime: anonHarness.runtime, httpsCallable: makeFactory({}) }
      )
    ).rejects.toThrow(/Invalid oaFetch request/);
  });

  it("passes { limitedUseAppCheckTokens: true } strictly on quotaGuard and redeemJudgeCode and refreshes ID token on judge redemption", async () => {
    const calls: Array<{ readonly name: string; readonly options: HttpsCallableOptions | undefined }> = [];
    const makeFactory = (payload: unknown): HttpsCallableFactory =>
      ((_fn, name, options) => {
        calls.push({ name, options });
        return (async () => ({ data: payload })) as never;
      }) as HttpsCallableFactory;

    const refreshSpy = vi.fn(async () => "refreshed-token");
    const harness = createOfflineRuntimeHarness({
      sdkOverrides: {
        getIdToken: refreshSpy,
      },
    });
    harness.setCurrentUser({ uid: "u1" } as never);

    await callQuotaGuard(
      { claimHashes: ["c".repeat(64)], kind: "L2" },
      {
        runtime: harness.runtime,
        httpsCallable: makeFactory({
          ok: true,
          pool: "anon",
          leaseId: "l1",
          leases: [{ claimHash: "c".repeat(64), leaseId: "l1", exp: 999999 }],
          exp: 999999,
          remainingToday: 9,
          resetsAt: 9999999,
        }),
      }
    );

    await callRedeemJudgeCode(
      { code: "TLMN-2345-6789" },
      {
        runtime: harness.runtime,
        httpsCallable: makeFactory({ ok: true, pool: "judge", tierExp: 2000000000 }),
      }
    );

    expect(calls).toEqual([
      { name: "quotaGuard", options: { limitedUseAppCheckTokens: true } },
      { name: "redeemJudgeCode", options: { limitedUseAppCheckTokens: true } },
    ]);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith(expect.anything(), true);
  });

  it("createBibResolveDoiResolver keeps only RESOLVED DOIs", async () => {
    const harness = createOfflineRuntimeHarness({
      runtimeOptions: { isJudgeOverride: () => false },
    });
    const resolver = createBibResolveDoiResolver({
      runtime: harness.runtime,
      httpsCallable: ((() => async () => ({
        data: {
          results: [
            {
              key: "alt_0",
              status: "RESOLVED",
              refId: "doi:10.1000/resolved",
              doi: "10.1000/resolved",
              openalexId: null,
              s2PaperId: null,
              title: "Resolved Title",
              authors: [],
              authorCount: 0,
              year: 2024,
              venue: null,
              isPreprint: false,
              isRetracted: false,
              retraction: null,
              mismatch: null,
              oaAvailable: false,
              abstract: null,
              abstractSource: null,
            },
            {
              key: "alt_1",
              status: "DOI_NOT_FOUND",
              refId: null,
              doi: "10.1000/missing",
              openalexId: null,
              s2PaperId: null,
              title: null,
              authors: [],
              authorCount: 0,
              year: null,
              venue: null,
              isPreprint: false,
              isRetracted: false,
              retraction: null,
              mismatch: null,
              oaAvailable: false,
              abstract: null,
              abstractSource: null,
            },
          ],
        },
      })) as unknown as HttpsCallableFactory),
    });

    const resolved = await resolver(["10.1000/resolved", "10.1000/missing"]);
    expect(Array.from(resolved.entries())).toEqual([
      ["10.1000/resolved", { doi: "10.1000/resolved", title: "Resolved Title" }],
    ]);
  });

  it("AC-SEC-15 & AC-SEC-17 & 04 §3.6.1/§5.1.5: src/ has zero debug tokens, forbidden sampling/thinking params, srcdoc, innerHTML, or hardcoded ISO dates", () => {
    const files = collectTsFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThanOrEqual(15);

    const forbiddenIdentifiers = new Set([
      "FIREBASE_APPCHECK_DEBUG_TOKEN",
      "CustomProvider",
      "thinkingBudget",
      "temperature",
      "topK",
      "topP",
      "srcdoc",
      "innerHTML",
    ]);
    const forbiddenStringLiterals = new Set([
      "FIREBASE_APPCHECK_DEBUG_TOKEN",
      "MINIMAL",
      "srcdoc",
      "innerHTML",
    ]);
    const isoDateRegex = /\b20[0-9]{2}-[0-9]{2}-[0-9]{2}\b/;

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, content);
      let token = scanner.scan();
      while (token !== ts.SyntaxKind.EndOfFileToken) {
        if (token === ts.SyntaxKind.Identifier) {
          const text = scanner.getTokenText();
          expect(forbiddenIdentifiers.has(text), `${file} must not use identifier ${text}`).toBe(false);
        } else if (
          token === ts.SyntaxKind.StringLiteral ||
          token === ts.SyntaxKind.NoSubstitutionTemplateLiteral
        ) {
          const val = scanner.getTokenValue();
          expect(forbiddenStringLiterals.has(val), `${file} must not contain string "${val}"`).toBe(false);
          expect(val, `${file} string literal must not contain hardcoded ISO date`).not.toMatch(isoDateRegex);
        }
        token = scanner.scan();
      }
      expect(content, `${file} must not contain hardcoded ISO date`).not.toMatch(isoDateRegex);
    }
  });
});
