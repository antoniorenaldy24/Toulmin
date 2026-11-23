import { describe, expect, it } from "vitest";
import vectors from "../../../conformance/l0/chunk.json" with { type: "json" };
import {
  chunkAbstract,
  chunkJatsXml,
  chunkPdfPages,
  chunkPhysicalTableRow,
  computeChunkId,
  computeEvidenceVersion,
  shapeEvidenceWindow,
  type EvidenceSourceKind,
  type EvidenceUnit,
  type PdfPageInput,
  type SelectRowCellInput,
} from "../src/index.js";

interface ChunkIdGoldenCase {
  readonly id: string;
  readonly op: "chunkId";
  readonly refId: string;
  readonly sourceKind: EvidenceSourceKind;
  readonly section: string;
  readonly ordinal: number;
  readonly textA: string;
  readonly textB: string;
  readonly expectedChunkIdA: string;
  readonly expectedChunkIdB: string;
  readonly expectedEvidenceVersion: string;
}

interface AbstractGoldenCase {
  readonly id: string;
  readonly op: "abstract";
  readonly refId: string;
  readonly rawAbstract: string;
  readonly expectedUnits: readonly EvidenceUnit[];
}

interface JatsGoldenCase {
  readonly id: string;
  readonly op: "jats";
  readonly refId: string;
  readonly xml: string;
  readonly expectedDoi: string | null;
  readonly expectedUnits: readonly EvidenceUnit[];
}

interface PdfGoldenCase {
  readonly id: string;
  readonly op: "pdf";
  readonly refId: string;
  readonly pages: readonly PdfPageInput[];
  readonly expectedHiddenTextPages: readonly number[];
  readonly expectedUnits: readonly EvidenceUnit[];
}

interface WindowShapeGoldenCase {
  readonly id: string;
  readonly op: "windowShape";
  readonly query: string;
  readonly words: readonly string[];
  readonly expectedStartWordIndex: number;
  readonly expectedWordCount: number;
  readonly expectedMatchCount: number;
}

interface PhysicalRowGoldenCase {
  readonly id: string;
  readonly op: "physicalRow";
  readonly refId: string;
  readonly photoSha256: string;
  readonly ordinal: number;
  readonly pairs: readonly SelectRowCellInput[];
  readonly expectedUnit: EvidenceUnit;
}

type ChunkGoldenCase =
  | ChunkIdGoldenCase
  | AbstractGoldenCase
  | JatsGoldenCase
  | PdfGoldenCase
  | WindowShapeGoldenCase
  | PhysicalRowGoldenCase;

describe("conformance/l0/chunk.json", () => {
  const cases = vectors as unknown as readonly ChunkGoldenCase[];

  for (const tc of cases) {
    it(`${tc.id}`, () => {
      switch (tc.op) {
        case "chunkId": {
          const idA = computeChunkId(tc.refId, tc.sourceKind, tc.section, tc.ordinal, tc.textA);
          const idB = computeChunkId(tc.refId, tc.sourceKind, tc.section, tc.ordinal, tc.textB);
          expect(idA).toBe(tc.expectedChunkIdA);
          expect(idB).toBe(tc.expectedChunkIdB);
          expect(idA).not.toBe(idB);
          expect(computeEvidenceVersion([idB, idA])).toBe(tc.expectedEvidenceVersion);
          expect(computeEvidenceVersion([idA, idB])).toBe(tc.expectedEvidenceVersion);
          break;
        }
        case "abstract": {
          const units = chunkAbstract(tc.refId, tc.rawAbstract);
          expect(units).toEqual(tc.expectedUnits);
          break;
        }
        case "jats": {
          const res = chunkJatsXml(tc.refId, tc.xml);
          expect(res.doi).toBe(tc.expectedDoi);
          expect(res.units).toEqual(tc.expectedUnits);
          break;
        }
        case "pdf": {
          const res = chunkPdfPages(tc.refId, tc.pages);
          expect(res.hiddenTextPages).toEqual(tc.expectedHiddenTextPages);
          expect(res.units).toEqual(tc.expectedUnits);
          break;
        }
        case "windowShape": {
          const fullText = tc.words.join(" ");
          const shaped = shapeEvidenceWindow(fullText, tc.query);
          expect(shaped.startWordIndex).toBe(tc.expectedStartWordIndex);
          expect(shaped.wordCount).toBe(tc.expectedWordCount);
          expect(shaped.matchCount).toBe(tc.expectedMatchCount);
          expect(shaped.text).toBe(
            tc.words
              .slice(tc.expectedStartWordIndex, tc.expectedStartWordIndex + tc.expectedWordCount)
              .join(" "),
          );
          break;
        }
        case "physicalRow": {
          const unit = chunkPhysicalTableRow(tc.refId, tc.photoSha256, tc.pairs, tc.ordinal);
          expect(unit).toEqual(tc.expectedUnit);
          break;
        }
      }
    });
  }
});
