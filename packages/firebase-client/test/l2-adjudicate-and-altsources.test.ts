import { describe, expect, it, vi } from "vitest";
import { InferenceMode, InferenceSource, type GenerateContentResult } from "firebase/ai";
import { EN_COPY } from "@toulmin/copy";
import {
  validateCloudResult,
  type BibResolveRequest,
  type BibResolveResponse,
} from "@toulmin/schemas";
import {
  adjudicateClaimL2,
  altSources,
  createBibResolveDoiResolver,
  findAlternativeSources,
  l2Adjudicate,
  l2AdjudicateProvided,
  parseTextJsonL2,
} from "../src/index.js";
import { createOfflineRuntimeHarness, makeFakeModel } from "./helpers.js";

function makeL2Response(
  text: string,
  opts?: {
    readonly inferenceSource?: string;
    readonly renderedContent?: string;
    readonly chunks?: ReadonlyArray<{ readonly web?: { readonly uri?: string; readonly title?: string } }>;
    readonly webSearchQueries?: readonly string[];
  }
): GenerateContentResult {
  return {
    response: {
      text: () => text,
      inferenceSource: opts?.inferenceSource ?? InferenceSource.IN_CLOUD,
      usageMetadata: {
        promptTokenCount: 200,
        candidatesTokenCount: 120,
        thoughtsTokenCount: 40,
        totalTokenCount: 360,
      },
      candidates: [
        {
          index: 0,
          finishReason: "STOP",
          groundingMetadata: {
            ...(opts?.renderedContent !== undefined
              ? { searchEntryPoint: { renderedContent: opts.renderedContent } }
              : {}),
            ...(opts?.chunks !== undefined ? { groundingChunks: [...opts.chunks] } : {}),
            ...(opts?.webSearchQueries !== undefined
              ? { webSearchQueries: [...opts.webSearchQueries] }
              : {}),
          },
        },
      ],
    },
  } as unknown as GenerateContentResult;
}

describe("L2 cloud adjudicators, post-checks & AltSourcesV1", () => {
  it("AC-L2-04: single-call SCHEMA and TEXT_JSON fallback parse without second model call and enforce thinking/token config", async () => {
    const harness = createOfflineRuntimeHarness();
    const schemaModel = l2Adjudicate(harness.runtime);
    const providedModel = l2AdjudicateProvided(harness.runtime);

    expect(schemaModel).toBe(l2Adjudicate(harness.runtime));
    expect(providedModel).toBe(l2AdjudicateProvided(harness.runtime));

    const schemaParams = harness.createdModels[0]!.params as unknown as Record<string, unknown>;
    const schemaInCloud = schemaParams["inCloudParams"] as Record<string, unknown>;
    const schemaGen = schemaInCloud["generationConfig"] as Record<string, unknown>;
    expect(schemaParams["mode"]).toBe(InferenceMode.ONLY_IN_CLOUD);
    expect(schemaInCloud["tools"]).toEqual([{ googleSearch: {} }]);
    expect(schemaGen["maxOutputTokens"]).toBe(2048);
    expect(schemaGen["thinkingConfig"]).toEqual({ thinkingLevel: "LOW" });
    expect(schemaGen["thinkingBudget"]).toBeUndefined();

    const providedParams = harness.createdModels[1]!.params as unknown as Record<string, unknown>;
    const providedInCloud = providedParams["inCloudParams"] as Record<string, unknown>;
    expect(providedInCloud["tools"]).toBeUndefined();

    // Deterministic TEXT_JSON parser: fenced block + trailing commas.
    const fencedWithTrailingComma = [
      "Here is the JSON:",
      "```json",
      "{",
      '  "s1_source_identified": "CITED_DOI_MATCHED",',
      '  "s2_quote": "Mortality decreased by 30% in the intervention group.",',
      '  "s3_quote_origin": "PROVIDED_EVIDENCE",',
      '  "s4_reasoning": "The paper reports the same 30% reduction in mortality.",',
      '  "s5_verdict": "SUPPORTED",',
      '  "s6_alternatives": [],',
      "}",
      "```",
    ].join("\n");
    const parsedFenced = parseTextJsonL2(fencedWithTrailingComma);
    expect(parsedFenced.ok).toBe(true);

    // Unreadable output returns NEI without a second model call.
    const generateSpy = vi.fn(async () =>
      makeL2Response("not valid json at all", {
        renderedContent: "<div>Search</div>",
      })
    );
    const fakeTextJsonModel = makeFakeModel({ generateContent: generateSpy });
    const out = await adjudicateClaimL2(
      {
        normalizedClaimHash: "a".repeat(64),
        approvedClaimText: "Drug X reduced mortality by 30%.",
        refId: "doi:10.1234/abc",
        reference: {
          title: "Trial X",
          firstAuthor: "Smith",
          year: 2024,
          venue: "Journal",
          doi: "10.1234/abc",
        },
        evidence: ["Mortality decreased by 30% in the intervention group."],
        suspicious: false,
        mode: "TEXT_JSON",
      },
      { runtime: harness.runtime, model: fakeTextJsonModel }
    );

    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(out.persisted.verdict).toBe("NEI");
    expect(out.statusMessage).toBe(EN_COPY.cloud.unreadableJson);

    // Deterministic TEXT_JSON parser: balanced braces without markdown fence + key-order guard.
    const unfencedJson = [
      "Preamble text {",
      '  "s1_source_identified": "CITED_DOI_MATCHED",',
      '  "s2_quote": "Mortality decreased by 30% in the intervention group.",',
      '  "s3_quote_origin": "PROVIDED_EVIDENCE",',
      '  "s4_reasoning": "Supported.",',
      '  "s5_verdict": "SUPPORTED",',
      '  "s6_alternatives": []',
      "} trailing commentary.",
    ].join("\n");
    expect(parseTextJsonL2(unfencedJson).ok).toBe(true);

    const outOfOrder = parseTextJsonL2(
      JSON.stringify({
        s2_quote: "q",
        s1_source_identified: "CITED_DOI_MATCHED",
        s3_quote_origin: "PROVIDED_EVIDENCE",
        s4_reasoning: "r",
        s5_verdict: "SUPPORTED",
        s6_alternatives: [],
      })
    );
    expect(outOfOrder.ok).toBe(false);
    if (!outOfOrder.ok) {
      expect(outOfOrder.error).toBe("KEY_ORDER");
    }

    // Optional thinkingConfig: undefined omits thinkingConfig cleanly.
    l2Adjudicate(harness.runtime, { thinkingConfig: undefined });
    const noThinkParams = harness.createdModels[2]!.params as unknown as Record<string, unknown>;
    const noThinkInCloud = noThinkParams["inCloudParams"] as Record<string, unknown>;
    const noThinkGen = noThinkInCloud["generationConfig"] as Record<string, unknown>;
    expect(noThinkGen["thinkingConfig"]).toBeUndefined();
  });

  it("AC-L2-05 & AC-L2-06 & AC-GND-01: enforces all seven L2 post-checks, alternative DOI filtering, and zero persisted grounded text", async () => {
    const harness = createOfflineRuntimeHarness();
    const baseInput = {
      normalizedClaimHash: "b".repeat(64),
      approvedClaimText: "Drug X reduced mortality by 30% in older adults.",
      refId: "doi:10.1234/abc",
      reference: {
        title: "Trial X",
        firstAuthor: "Smith",
        year: 2024,
        venue: "Journal",
        doi: "10.1234/abc",
      },
      evidence: ["In older adults, Drug X reduced mortality by 30% compared with placebo."],
      suspicious: false,
    };

    // (a) PROVIDED_EVIDENCE quote absent from evidence -> downgraded to NEI.
    const absentQuoteOut = await adjudicateClaimL2(baseInput, {
      runtime: harness.runtime,
      model: makeFakeModel({
        generateContent: async () =>
          makeL2Response(
            JSON.stringify({
              s1_source_identified: "CITED_DOI_MATCHED",
              s2_quote: "This sentence never appears in the supplied evidence at all.",
              s3_quote_origin: "PROVIDED_EVIDENCE",
              s4_reasoning: "Matches claim.",
              s5_verdict: "SUPPORTED",
              s6_alternatives: [],
            }),
            { renderedContent: "<div>Search</div>" }
          ),
      }),
    });
    expect(absentQuoteOut.persisted.verdict).toBe("NEI");
    expect(absentQuoteOut.persisted.quote).toBeNull();

    // (b) CONTRADICTED whose quote equals claim -> NEI (NO_DIFFERENCE_SIGNAL).
    const identicalOut = await adjudicateClaimL2(
      {
        ...baseInput,
        approvedClaimText: "Drug X reduced mortality by 30% in older adults.",
        evidence: ["Drug X reduced mortality by 30% in older adults."],
      },
      {
        runtime: harness.runtime,
        model: makeFakeModel({
          generateContent: async () =>
            makeL2Response(
              JSON.stringify({
                s1_source_identified: "CITED_DOI_MATCHED",
                s2_quote: "Drug X reduced mortality by 30% in older adults.",
                s3_quote_origin: "PROVIDED_EVIDENCE",
                s4_reasoning: "Contradicts.",
                s5_verdict: "CONTRADICTED",
                s6_alternatives: [],
              }),
              { renderedContent: "<div>Search</div>" }
            ),
        }),
      }
    );
    expect(identicalOut.persisted.verdict).toBe("NEI");

    // (c) CONTRADICTED on subject swap without values -> kept with noDifferenceNote = true.
    const swapOut = await adjudicateClaimL2(
      {
        ...baseInput,
        approvedClaimText: "Alpha inhibited beta in human hepatocytes.",
        evidence: ["Beta inhibited alpha in human hepatocytes."],
      },
      {
        runtime: harness.runtime,
        model: makeFakeModel({
          generateContent: async () =>
            makeL2Response(
              JSON.stringify({
                s1_source_identified: "CITED_DOI_MATCHED",
                s2_quote: "Beta inhibited alpha in human hepatocytes.",
                s3_quote_origin: "PROVIDED_EVIDENCE",
                s4_reasoning: "The subject and object are reversed.",
                s5_verdict: "CONTRADICTED",
                s6_alternatives: [],
              }),
              { renderedContent: "<div>Search</div>" }
            ),
        }),
      }
    );
    expect(swapOut.persisted.verdict).toBe("CONTRADICTED");
    expect(swapOut.persisted.noDifferenceNote).toBe(true);
    expect(swapOut.statusMessage).toBe(EN_COPY.cloud.noDifferenceNote);

    // (d) WEB_SOURCE -> persisted NEI + quote: null, session display carries webSourcesOnly & hides Re-run;
    //     also tests AC-L2-06 (1 valid DOI kept, 1 invalid DOI discarded) & AC-GND-01 (no grounded fields persisted).
    const webOut = await adjudicateClaimL2(baseInput, {
      runtime: harness.runtime,
      model: makeFakeModel({
        generateContent: async () =>
          makeL2Response(
            JSON.stringify({
              s1_source_identified: "CITED_DOI_MATCHED",
              s2_quote: "Web snippet shows mortality increased by 10%.",
              s3_quote_origin: "WEB_SOURCE",
              s4_reasoning: "Web source contradicts claim.",
              s5_verdict: "CONTRADICTED",
              s6_alternatives: [
                { a1_doi: "10.1000/valid", a2_relation: "CONTRADICTS_CLAIM" },
                { a1_doi: "10.9999/unresolved", a2_relation: "CONTRADICTS_CLAIM" },
              ],
            }),
            {
              renderedContent: "<div class='google-search'>Suggestions</div>",
              webSearchQueries: ["Trial X mortality"],
              chunks: [
                { web: { uri: "https://publisher.org/doi/full/10.1234/abc", title: "Paper" } },
                { web: { uri: "https://other.org/news", title: "News" } },
              ],
            }
          ),
      }),
      resolveAlternativeDois: async () =>
        new Map([["10.1000/valid", { doi: "10.1000/valid", title: "Valid Alt Paper" }]]),
    });

    expect(webOut.persisted.verdict).toBe("NEI");
    expect(webOut.persisted.quote).toBeNull();
    expect(webOut.persisted.quoteAnchor).toBeNull();
    expect(webOut.persisted.alternativesDois).toEqual(["10.1000/valid"]);
    expect(validateCloudResult(webOut.persisted).ok).toBe(true);
    expect((webOut.persisted as unknown as Record<string, unknown>)["renderedContent"]).toBeUndefined();
    expect((webOut.persisted as unknown as Record<string, unknown>)["groundingChunks"]).toBeUndefined();

    expect(webOut.sessionDisplay?.isWebSourceOnly).toBe(true);
    expect(webOut.sessionDisplay?.label).toBe(EN_COPY.cloud.webSourcesOnly);
    expect(webOut.sessionDisplay?.hideRerunUntilEvidenceVersionChanges).toBe(true);
    expect(webOut.sessionDisplay?.resolvedAlternatives).toEqual([
      { doi: "10.1000/valid", title: "Valid Alt Paper" },
    ]);
    expect(webOut.sessionDisplay?.sources[0]?.isThisPaper).toBe(true);
    expect(webOut.sessionDisplay?.sources[1]?.isThisPaper).toBe(false);

    // (e) s1_source_identified === "NOT_IDENTIFIED" -> NEI + sourceNotConfirmed.
    const notIdentifiedOut = await adjudicateClaimL2(baseInput, {
      runtime: harness.runtime,
      model: makeFakeModel({
        generateContent: async () =>
          makeL2Response(
            JSON.stringify({
              s1_source_identified: "NOT_IDENTIFIED",
              s2_quote: "In older adults, Drug X reduced mortality by 30% compared with placebo.",
              s3_quote_origin: "PROVIDED_EVIDENCE",
              s4_reasoning: "Cannot confirm source.",
              s5_verdict: "SUPPORTED",
              s6_alternatives: [],
            }),
            { renderedContent: "<div>Search</div>" }
          ),
      }),
    });
    expect(notIdentifiedOut.persisted.verdict).toBe("NEI");
    expect(notIdentifiedOut.statusMessage).toBe(EN_COPY.cloud.sourceNotConfirmed);

    // (f) Missing searchEntryPoint.renderedContent on l2Adjudicate:
    //     WEB_SOURCE is downgraded to NEI (sessionDisplay: null), whereas PROVIDED_EVIDENCE succeeds cleanly.
    const missingSearchWebOut = await adjudicateClaimL2(baseInput, {
      runtime: harness.runtime,
      model: makeFakeModel({
        generateContent: async () =>
          makeL2Response(
            JSON.stringify({
              s1_source_identified: "CITED_DOI_MATCHED",
              s2_quote: "Web snippet.",
              s3_quote_origin: "WEB_SOURCE",
              s4_reasoning: "Web.",
              s5_verdict: "SUPPORTED",
              s6_alternatives: [],
            }),
            {
              chunks: [{ web: { uri: "https://publisher.org/doi/10.1234/abc", title: "Paper" } }],
            }
          ),
      }),
    });
    expect(missingSearchWebOut.persisted.verdict).toBe("NEI");
    expect(missingSearchWebOut.sessionDisplay).toBeNull();

    const missingSearchProvidedOut = await adjudicateClaimL2(baseInput, {
      runtime: harness.runtime,
      model: makeFakeModel({
        generateContent: async () =>
          makeL2Response(
            JSON.stringify({
              s1_source_identified: "CITED_DOI_MATCHED",
              s2_quote: "In older adults, Drug X reduced mortality by 30% compared with placebo.",
              s3_quote_origin: "PROVIDED_EVIDENCE",
              s4_reasoning: "Matches provided evidence directly.",
              s5_verdict: "SUPPORTED",
              s6_alternatives: [],
            }),
            {
              chunks: [{ web: { uri: "https://publisher.org/doi/10.1234/abc", title: "Paper" } }],
            }
          ),
      }),
    });
    expect(missingSearchProvidedOut.persisted.verdict).toBe("SUPPORTED");
    expect(missingSearchProvidedOut.sessionDisplay?.renderedContent).toBeNull();
    expect(missingSearchProvidedOut.sessionDisplay?.sources).toEqual([]);
    expect(missingSearchProvidedOut.sessionDisplay?.groundingChunks).toEqual([]);

    // (g) l2AdjudicateProvided with no grounding metadata: PROVIDED_EVIDENCE succeeds, WEB_SOURCE becomes NEI.
    const providedOnlyOut = await adjudicateClaimL2(
      { ...baseInput, adjudicator: "l2AdjudicateProvided" },
      {
        runtime: harness.runtime,
        model: makeFakeModel({
          generateContent: async () =>
            makeL2Response(
              JSON.stringify({
                s1_source_identified: "CITED_DOI_MATCHED",
                s2_quote: "In older adults, Drug X reduced mortality by 30% compared with placebo.",
                s3_quote_origin: "PROVIDED_EVIDENCE",
                s4_reasoning: "Matches supplied evidence.",
                s5_verdict: "SUPPORTED",
                s6_alternatives: [],
              })
            ),
        }),
      }
    );
    expect(providedOnlyOut.persisted.verdict).toBe("SUPPORTED");
    expect(providedOnlyOut.statusMessage).toBe(EN_COPY.cloud.providedEvidenceOnly);

    const providedWebOut = await adjudicateClaimL2(
      { ...baseInput, adjudicator: "l2AdjudicateProvided" },
      {
        runtime: harness.runtime,
        model: makeFakeModel({
          generateContent: async () =>
            makeL2Response(
              JSON.stringify({
                s1_source_identified: "CITED_DOI_MATCHED",
                s2_quote: "Web snippet.",
                s3_quote_origin: "WEB_SOURCE",
                s4_reasoning: "Web.",
                s5_verdict: "SUPPORTED",
                s6_alternatives: [],
              })
            ),
        }),
      }
    );
    expect(providedWebOut.persisted.verdict).toBe("NEI");

    // (h) Post-check order: NOT_IDENTIFIED (check 3) short-circuits BEFORE alternative DOI resolution (check 5).
    const altHookSpy = vi.fn(async () => new Map([["10.1000/alt", { doi: "10.1000/alt", title: "Alt" }]]));
    const notIdWithAltOut = await adjudicateClaimL2(baseInput, {
      runtime: harness.runtime,
      model: makeFakeModel({
        generateContent: async () =>
          makeL2Response(
            JSON.stringify({
              s1_source_identified: "NOT_IDENTIFIED",
              s2_quote: "In older adults, Drug X reduced mortality by 30% compared with placebo.",
              s3_quote_origin: "PROVIDED_EVIDENCE",
              s4_reasoning: "Cannot confirm source.",
              s5_verdict: "SUPPORTED",
              s6_alternatives: [{ a1_doi: "10.1000/alt", a2_relation: "SUPPORTS_CLAIM" }],
            }),
            { renderedContent: "<div>Search</div>" }
          ),
      }),
      resolveAlternativeDois: altHookSpy,
    });
    expect(notIdWithAltOut.persisted.verdict).toBe("NEI");
    expect(notIdWithAltOut.persisted.alternativesDois).toEqual([]);
    expect(altHookSpy).toHaveBeenCalledTimes(0);

    // (i) Real createBibResolveDoiResolver integration: normalizes URL/doi: prefixes, drops syntactically invalid DOIs,
    //     and still resolves the valid DOI without failing the whole batch.
    const bibSpy = vi.fn(async (req: BibResolveRequest): Promise<{ data: BibResolveResponse }> => ({
      data: {
        results: req.items.map((item) => ({
          key: item.key,
          status: item.doi === "10.1000/valid" ? "RESOLVED" : "DOI_NOT_FOUND",
          refId: item.doi === "10.1000/valid" ? "doi:10.1000/valid" : null,
          doi: item.doi === "10.1000/valid" ? "10.1000/valid" : null,
          openalexId: null,
          s2PaperId: null,
          title: item.doi === "10.1000/valid" ? "Resolved Valid Alt" : null,
          authors: [],
          authorCount: 0,
          year: 2024,
          venue: "Journal",
          isPreprint: false,
          isRetracted: false,
          retraction: null,
          mismatch: null,
          oaAvailable: false,
          abstract: null,
          abstractSource: null,
        })),
      },
    }));
    const realResolver = createBibResolveDoiResolver({
      runtime: harness.runtime,
      httpsCallable: (() => (req: BibResolveRequest) => bibSpy(req)) as never,
      isJudge: false,
    });
    const mixedDoiOut = await adjudicateClaimL2(baseInput, {
      runtime: harness.runtime,
      model: makeFakeModel({
        generateContent: async () =>
          makeL2Response(
            JSON.stringify({
              s1_source_identified: "CITED_DOI_MATCHED",
              s2_quote: "Web snippet.",
              s3_quote_origin: "WEB_SOURCE",
              s4_reasoning: "Web.",
              s5_verdict: "CONTRADICTED",
              s6_alternatives: [
                { a1_doi: "not-a-valid-doi", a2_relation: "CONTRADICTS_CLAIM" },
                { a1_doi: "https://doi.org/10.1000/valid", a2_relation: "CONTRADICTS_CLAIM" },
              ],
            }),
            { renderedContent: "<div>Search</div>" }
          ),
      }),
      resolveAlternativeDois: realResolver,
    });
    expect(bibSpy).toHaveBeenCalledTimes(1);
    expect(bibSpy.mock.calls[0]?.[0]?.items).toEqual([{ key: "alt_0", doi: "10.1000/valid" }]);
    expect(mixedDoiOut.persisted.alternativesDois).toEqual(["10.1000/valid"]);
    expect(mixedDoiOut.sessionDisplay?.resolvedAlternatives).toEqual([
      { doi: "10.1000/valid", title: "Resolved Valid Alt" },
    ]);

    const onlyInvalidResolved = await realResolver(["not-a-valid-doi", "10.123"]);
    expect(onlyInvalidResolved.size).toBe(0);
    expect(bibSpy).toHaveBeenCalledTimes(1);

    // (j) 8-block / 6,000-token evidence boundary: 9th block (idx 8) & >6k-token overflow blocks are excluded from validateL2Verdict.
    const nineUnits = [
      "Filler block zero about baseline characteristics.",
      "Filler block one about inclusion criteria.",
      "Filler block two about dosing schedule.",
      "Filler block three about randomization.",
      "Filler block four about blinding protocol.",
      "Filler block five about statistical methods.",
      "Filler block six about follow-up duration.",
      "Filler block seven about safety monitoring.",
      "In older adults, Drug X reduced mortality by 30% compared with placebo.",
    ];
    const ninthBlockOut = await adjudicateClaimL2(
      { ...baseInput, evidence: nineUnits },
      {
        runtime: harness.runtime,
        model: makeFakeModel({
          generateContent: async () =>
            makeL2Response(
              JSON.stringify({
                s1_source_identified: "CITED_DOI_MATCHED",
                s2_quote: "In older adults, Drug X reduced mortality by 30% compared with placebo.",
                s3_quote_origin: "PROVIDED_EVIDENCE",
                s4_reasoning: "Matches block 8.",
                s5_verdict: "SUPPORTED",
                s6_alternatives: [],
              }),
              { renderedContent: "<div>Search</div>" }
            ),
        }),
      }
    );
    expect(ninthBlockOut.persisted.verdict).toBe("NEI");

    const fittingBlock0 = `${"word ".repeat(2500)}baseline details.`;
    const overflowBlock1 = `${"extra ".repeat(1000)} In older adults, Drug X reduced mortality by 30% compared with placebo.`;
    const overflowTokenOut = await adjudicateClaimL2(
      {
        ...baseInput,
        evidence: [fittingBlock0, overflowBlock1],
      },
      {
        runtime: harness.runtime,
        model: makeFakeModel({
          generateContent: async () =>
            makeL2Response(
              JSON.stringify({
                s1_source_identified: "CITED_DOI_MATCHED",
                s2_quote: "In older adults, Drug X reduced mortality by 30% compared with placebo.",
                s3_quote_origin: "PROVIDED_EVIDENCE",
                s4_reasoning: "Matches overflow block.",
                s5_verdict: "SUPPORTED",
                s6_alternatives: [],
              }),
              { renderedContent: "<div>Search</div>" }
            ),
        }),
      }
    );
    expect(overflowTokenOut.persisted.verdict).toBe("NEI");
  });

  it("04 §4.5: AltSourcesV1 strips s2_dois on ON_DEVICE responses and resolves DOIs only in Standard IN_CLOUD mode", async () => {
    const harness = createOfflineRuntimeHarness();
    const mDevice = altSources(true, harness.runtime);
    const mHybrid = altSources(false, harness.runtime);
    expect(mDevice).not.toBe(mHybrid);

    // On-device response attempting to return s2_dois -> stripped to [].
    const onDeviceOut = await findAlternativeSources(
      {
        approvedClaimText: "Drug X reduces mortality.",
        library: [{ title: "Library Study A", year: 2023 }],
        confidential: false,
      },
      {
        runtime: harness.runtime,
        model: makeFakeModel({
          generateContent: async () => ({
            response: {
              text: () =>
                JSON.stringify({
                  s1_library_idx: [0, 5],
                  s2_dois: ["10.1000/hallucinated"],
                }),
              inferenceSource: InferenceSource.ON_DEVICE,
            },
          }) as unknown as GenerateContentResult,
        }),
        resolveAlternativeDois: async () =>
          new Map([["10.1000/hallucinated", { doi: "10.1000/hallucinated", title: "Should Strip" }]]),
      }
    );
    expect(onDeviceOut.inferenceSource).toBe("ON_DEVICE");
    expect(onDeviceOut.libraryIndices).toEqual([0]);
    expect(onDeviceOut.resolvedDois).toEqual([]);

    // Cloud response in Standard mode keeps resolved DOIs.
    const cloudOut = await findAlternativeSources(
      {
        approvedClaimText: "Drug X reduces mortality.",
        library: [{ title: "Library Study A", year: 2023 }],
        confidential: false,
      },
      {
        runtime: harness.runtime,
        model: makeFakeModel({
          generateContent: async () => ({
            response: {
              text: () =>
                JSON.stringify({
                  s1_library_idx: [0],
                  s2_dois: ["10.1000/good", "10.1000/bad"],
                }),
              inferenceSource: InferenceSource.IN_CLOUD,
            },
          }) as unknown as GenerateContentResult,
        }),
        resolveAlternativeDois: async () =>
          new Map([["10.1000/good", { doi: "10.1000/good", title: "Good Paper" }]]),
      }
    );
    expect(cloudOut.inferenceSource).toBe("IN_CLOUD");
    expect(cloudOut.resolvedDois).toEqual([{ doi: "10.1000/good", title: "Good Paper" }]);
  });
});
