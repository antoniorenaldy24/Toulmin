import { describe, expect, it } from "vitest";
import vectors from "../../../conformance/l0/claimhash.json" with { type: "json" };
import { normalizedClaim, normalizedClaimHash } from "../src/index.js";

interface ClaimHashGoldenCase {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly lang?: string;
  readonly expectedA: string;
  readonly expectedB: string;
  readonly expectedEqual: boolean;
}

function isLowerHex64(s: string): boolean {
  if (s.length !== 64) {
    return false;
  }
  for (let i = 0; i < 64; i++) {
    const cu = s.charCodeAt(i);
    if (!((cu >= 48 && cu <= 57) || (cu >= 97 && cu <= 102))) {
      return false;
    }
  }
  return true;
}

describe("conformance/l0/claimhash.json (AC-L0-21)", () => {
  const cases = vectors as unknown as readonly ClaimHashGoldenCase[];

  for (const tc of cases) {
    it(`${tc.id}`, () => {
      const opts = tc.lang !== undefined ? { lang: tc.lang } : undefined;
      const normA = normalizedClaim(tc.a, opts);
      const normB = normalizedClaim(tc.b, opts);
      const hashA = normalizedClaimHash(tc.a, opts);
      const hashB = normalizedClaimHash(tc.b, opts);

      expect(normA).toBe(tc.expectedA);
      expect(normB).toBe(tc.expectedB);
      expect(isLowerHex64(hashA)).toBe(true);
      expect(isLowerHex64(hashB)).toBe(true);
      expect(hashA === hashB).toBe(tc.expectedEqual);
    });
  }
});
