import type { OaParseResponse } from "@toulmin/schemas";
import { detectMagicBytes } from "../net/magic.js";
import { parseJatsDocument } from "./jats.js";
import { parsePdfDocument, type PdfPageExtractorFn } from "./pdf.js";

export interface ParseHandlerResult {
  readonly status: number;
  readonly body: OaParseResponse | { readonly error: string };
}

export interface ParseHandlerDeps {
  readonly extractPdfPages?: PdfPageExtractorFn;
}

const MAX_PARSE_BYTES = 25 * 1024 * 1024;

export async function executeParseBuffer(
  bytes: Uint8Array,
  refId = "oa_parse",
  deps?: ParseHandlerDeps
): Promise<ParseHandlerResult> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PARSE_BYTES) {
    return { status: 400, body: { error: "INVALID_PAYLOAD_SIZE" } };
  }

  const magic = detectMagicBytes(bytes);
  if (magic === "PDF") {
    const parsed = await parsePdfDocument(bytes, refId, {
      ...(deps?.extractPdfPages ? { extractPages: deps.extractPdfPages } : {}),
    });
    return { status: 200, body: parsed };
  }

  if (magic === "XML") {
    const xmlText = new TextDecoder("utf-8").decode(bytes);
    const parsed = parseJatsDocument(xmlText, refId);
    return {
      status: 200,
      body: {
        kind: parsed.kind,
        units: parsed.units,
        identity: parsed.identity,
        hiddenTextDropped: parsed.hiddenTextDropped,
      },
    };
  }

  return { status: 415, body: { error: "UNSUPPORTED_MAGIC_BYTES" } };
}

export function extractParseInputFromHttpRequest(req: {
  readonly method?: string;
  readonly headers?: Record<string, string | string[] | undefined>;
  readonly rawBody?: Uint8Array;
  readonly body?: unknown;
}): { readonly ok: true; readonly bytes: Uint8Array; readonly refId: string } | { readonly ok: false; readonly status: number; readonly error: string } {
  if (req.method !== "POST") {
    return { ok: false, status: 405, error: "METHOD_NOT_ALLOWED" };
  }

  const headerRefId = req.headers?.["x-toulmin-refid"];
  const refIdFromHeader = Array.isArray(headerRefId) ? headerRefId[0] : headerRefId;

  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) && !(req.body instanceof Uint8Array)) {
    const obj = req.body as Record<string, unknown>;
    if (typeof obj["bytesBase64"] === "string") {
      const buf = Buffer.from(obj["bytesBase64"], "base64");
      const refId = typeof obj["refId"] === "string" ? obj["refId"] : (refIdFromHeader ?? "oa_parse");
      return { ok: true, bytes: new Uint8Array(buf), refId };
    }
  }

  if (req.rawBody && req.rawBody.byteLength > 0) {
    return {
      ok: true,
      bytes: req.rawBody instanceof Uint8Array ? req.rawBody : new Uint8Array(req.rawBody),
      refId: refIdFromHeader ?? "oa_parse",
    };
  }

  if (req.body instanceof Uint8Array || Buffer.isBuffer(req.body)) {
    return {
      ok: true,
      bytes: new Uint8Array(req.body),
      refId: refIdFromHeader ?? "oa_parse",
    };
  }

  return { ok: false, status: 400, error: "MISSING_BODY" };
}
