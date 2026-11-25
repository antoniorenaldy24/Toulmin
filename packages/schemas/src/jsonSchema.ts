/**
 * Canonical JSON Schema registry, strict pure schema validator, streaming key-order checker,
 * and `sumOfStringMaxLength` / `STREAM_CHAR_LIMIT` helpers (`04` §1.4, §2, §5.1.7).
 *
 * Pure module: zero Firebase, DOM, network, Node I/O, clock, or regex usage.
 */

import altSourcesV1Schema from "../AltSourcesV1.schema.json" with { type: "json" };
import b5CheckV1Schema from "../B5CheckV1.schema.json" with { type: "json" };
import l2VerdictSchema from "../L2Verdict.schema.json" with { type: "json" };
import o2PhysicalExtractFlatV1Schema from "../O2PhysicalExtractFlatV1.schema.json" with { type: "json" };
import o2PhysicalExtractV1Schema from "../O2PhysicalExtractV1.schema.json" with { type: "json" };
import triageFlatV1Schema from "../TriageFlatV1.schema.json" with { type: "json" };
import triageV1Schema from "../TriageV1.schema.json" with { type: "json" };
import verdictFlatV1Schema from "../VerdictFlatV1.schema.json" with { type: "json" };
import verdictV1Cap20Schema from "../VerdictV1_cap20.schema.json" with { type: "json" };
import verdictV1Cap30Schema from "../VerdictV1_cap30.schema.json" with { type: "json" };
import verdictV1Schema from "../VerdictV1.schema.json" with { type: "json" };
import type { AiSchemaOutputMap } from "./aiOutputs.js";

export const SCHEMA_IDS = [
  "TriageV1",
  "TriageFlatV1",
  "VerdictV1",
  "VerdictV1_cap30",
  "VerdictV1_cap20",
  "VerdictFlatV1",
  "B5CheckV1",
  "O2PhysicalExtractV1",
  "O2PhysicalExtractFlatV1",
  "L2Verdict",
  "AltSourcesV1",
] as const;

export type SchemaId = (typeof SCHEMA_IDS)[number];

/**
 * On-device Tier A JSON schemas (excludes cloud-only `L2Verdict`, `04` §2.6, D-30).
 */
export const TIER_A_SCHEMA_IDS = [
  "TriageV1",
  "TriageFlatV1",
  "VerdictV1",
  "VerdictV1_cap30",
  "VerdictV1_cap20",
  "VerdictFlatV1",
  "B5CheckV1",
  "O2PhysicalExtractV1",
  "O2PhysicalExtractFlatV1",
  "AltSourcesV1",
] as const;

export type TierASchemaId = (typeof TIER_A_SCHEMA_IDS)[number];

export interface JsonSchemaStringNode {
  readonly type: "string";
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly enum?: readonly string[];
}

export interface JsonSchemaNumberNode {
  readonly type: "integer" | "number";
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enum?: readonly number[];
}

export interface JsonSchemaBooleanNode {
  readonly type: "boolean";
}

export interface JsonSchemaArrayNode {
  readonly type: "array";
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly items: JsonSchemaNode;
}

export interface JsonSchemaObjectNode {
  readonly $id?: string;
  readonly type: "object";
  readonly additionalProperties?: boolean;
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, JsonSchemaNode>>;
}

export type JsonSchemaNode =
  | JsonSchemaStringNode
  | JsonSchemaNumberNode
  | JsonSchemaBooleanNode
  | JsonSchemaArrayNode
  | JsonSchemaObjectNode;

export type JsonSchemaObject = JsonSchemaObjectNode & { readonly $id: string };

export const SCHEMAS: Readonly<Record<SchemaId, JsonSchemaObject>> = {
  TriageV1: triageV1Schema as unknown as JsonSchemaObject,
  TriageFlatV1: triageFlatV1Schema as unknown as JsonSchemaObject,
  VerdictV1: verdictV1Schema as unknown as JsonSchemaObject,
  VerdictV1_cap30: verdictV1Cap30Schema as unknown as JsonSchemaObject,
  VerdictV1_cap20: verdictV1Cap20Schema as unknown as JsonSchemaObject,
  VerdictFlatV1: verdictFlatV1Schema as unknown as JsonSchemaObject,
  B5CheckV1: b5CheckV1Schema as unknown as JsonSchemaObject,
  O2PhysicalExtractV1: o2PhysicalExtractV1Schema as unknown as JsonSchemaObject,
  O2PhysicalExtractFlatV1: o2PhysicalExtractFlatV1Schema as unknown as JsonSchemaObject,
  L2Verdict: l2VerdictSchema as unknown as JsonSchemaObject,
  AltSourcesV1: altSourcesV1Schema as unknown as JsonSchemaObject,
};

export interface SchemaValidationError {
  readonly path: string;
  readonly message: string;
}

export type SchemaValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly SchemaValidationError[] };

export type ParseAiOutputResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error: "PARSE" | "KEY_ORDER" | "SCHEMA";
      readonly details: readonly string[];
    };

/**
 * Counts Unicode code points (scalar/surrogate-pair aware) matching JSON Schema `maxLength` / `minLength`.
 */
export function countUnicodeCodePoints(value: string): number {
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
      }
    }
    count += 1;
  }
  return count;
}

/**
 * Computes the worst-case sum of string field `maxLength` (or max enum string length)
 * for computing Web `STREAM_CHAR_LIMIT = ceil(1.2 * sumOfStringMaxLength(schema)) + 200` (`04` §1.4, §5.1.7).
 */
export function sumOfStringMaxLength(node: JsonSchemaNode): number {
  if (node.type === "string") {
    if (typeof node.maxLength === "number") {
      return node.maxLength;
    }
    if (Array.isArray(node.enum)) {
      let maxEnumLen = 0;
      for (const item of node.enum) {
        const len = countUnicodeCodePoints(item);
        if (len > maxEnumLen) {
          maxEnumLen = len;
        }
      }
      return maxEnumLen;
    }
    return 0;
  }
  if (node.type === "object") {
    let total = 0;
    for (const key of Object.keys(node.properties)) {
      const prop = node.properties[key];
      if (prop !== undefined) {
        total += sumOfStringMaxLength(prop);
      }
    }
    return total;
  }
  if (node.type === "array") {
    const multiplier = typeof node.maxItems === "number" ? node.maxItems : 1;
    return multiplier * sumOfStringMaxLength(node.items);
  }
  return 0;
}

/**
 * Computes `STREAM_CHAR_LIMIT = Math.ceil(1.2 * sumOfStringMaxLength(SCHEMAS[schemaId])) + 200` (`04` §5.1.7).
 */
export function streamCharLimit(schemaId: SchemaId): number {
  return Math.ceil(1.2 * sumOfStringMaxLength(SCHEMAS[schemaId])) + 200;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateNode(
  node: JsonSchemaNode,
  value: unknown,
  path: string,
  errors: SchemaValidationError[]
): void {
  if (node.type === "string") {
    if (typeof value !== "string") {
      errors.push({ path, message: "Expected string" });
      return;
    }
    const cpLen = countUnicodeCodePoints(value);
    if (typeof node.minLength === "number" && cpLen < node.minLength) {
      errors.push({ path, message: `String length ${cpLen} < minLength ${node.minLength}` });
    }
    if (typeof node.maxLength === "number" && cpLen > node.maxLength) {
      errors.push({ path, message: `String length ${cpLen} > maxLength ${node.maxLength}` });
    }
    if (node.enum !== undefined && !node.enum.includes(value)) {
      errors.push({ path, message: `Value "${value}" is not in enum [${node.enum.join(", ")}]` });
    }
    return;
  }

  if (node.type === "integer" || node.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push({ path, message: `Expected ${node.type}` });
      return;
    }
    if (node.type === "integer" && !Number.isInteger(value)) {
      errors.push({ path, message: `Expected integer, received ${value}` });
      return;
    }
    if (typeof node.minimum === "number" && value < node.minimum) {
      errors.push({ path, message: `Value ${value} < minimum ${node.minimum}` });
    }
    if (typeof node.maximum === "number" && value > node.maximum) {
      errors.push({ path, message: `Value ${value} > maximum ${node.maximum}` });
    }
    if (node.enum !== undefined && !node.enum.includes(value)) {
      errors.push({ path, message: `Value ${value} is not in numeric enum` });
    }
    return;
  }

  if (node.type === "boolean") {
    if (typeof value !== "boolean") {
      errors.push({ path, message: "Expected boolean" });
    }
    return;
  }

  if (node.type === "array") {
    if (!Array.isArray(value)) {
      errors.push({ path, message: "Expected array" });
      return;
    }
    if (typeof node.minItems === "number" && value.length < node.minItems) {
      errors.push({ path, message: `Array length ${value.length} < minItems ${node.minItems}` });
    }
    if (typeof node.maxItems === "number" && value.length > node.maxItems) {
      errors.push({ path, message: `Array length ${value.length} > maxItems ${node.maxItems}` });
    }
    for (let i = 0; i < value.length; i += 1) {
      validateNode(node.items, value[i], `${path}[${i}]`, errors);
    }
    return;
  }

  if (node.type === "object") {
    if (!isPlainRecord(value)) {
      errors.push({ path, message: "Expected object" });
      return;
    }
    for (const reqKey of node.required) {
      if (!Object.prototype.hasOwnProperty.call(value, reqKey) || value[reqKey] === undefined) {
        errors.push({ path: `${path}.${reqKey}`, message: `Missing required property "${reqKey}"` });
      }
    }
    for (const key of Object.keys(value)) {
      const propSchema = Object.prototype.hasOwnProperty.call(node.properties, key)
        ? node.properties[key]
        : undefined;
      if (propSchema === undefined) {
        if (node.additionalProperties === false) {
          errors.push({ path: `${path}.${key}`, message: `Unknown property "${key}" is not allowed` });
        }
        continue;
      }
      validateNode(propSchema, value[key], `${path}.${key}`, errors);
    }
  }
}

/**
 * Validates any value against one of the canonical JSON Schemas without external dependencies.
 */
export function validateJsonSchema(schema: JsonSchemaNode, value: unknown): SchemaValidationResult {
  const errors: SchemaValidationError[] = [];
  validateNode(schema, value, "$", errors);
  if (errors.length === 0) {
    return { ok: true };
  }
  return { ok: false, errors };
}

function isJsonWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function skipWs(text: string, start: number): number {
  let i = start;
  while (i < text.length && isJsonWhitespace(text.charAt(i))) {
    i += 1;
  }
  return i;
}

function parseJsonStringToken(
  text: string,
  start: number
): { readonly value: string; readonly nextIndex: number } | null {
  if (text.charAt(start) !== '"') {
    return null;
  }
  let i = start + 1;
  let hasEscape = false;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === "\\") {
      hasEscape = true;
      if (i + 1 >= text.length) {
        return null;
      }
      if (text.charAt(i + 1) === "u") {
        if (i + 5 >= text.length) {
          return null;
        }
        i += 6;
      } else {
        i += 2;
      }
      continue;
    }
    if (ch === '"') {
      const rawSlice = text.slice(start, i + 1);
      if (!hasEscape) {
        return { value: text.slice(start + 1, i), nextIndex: i + 1 };
      }
      try {
        const parsed: unknown = JSON.parse(rawSlice);
        if (typeof parsed !== "string") {
          return null;
        }
        return { value: parsed, nextIndex: i + 1 };
      } catch {
        return null;
      }
    }
    if (ch.charCodeAt(0) < 0x20) {
      return null;
    }
    i += 1;
  }
  return null;
}

function isAsciiDigitChar(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isValidJsonNumberToken(token: string): boolean {
  let i = 0;
  if (token.charCodeAt(i) === 0x2d /* - */) {
    i += 1;
  }
  if (i >= token.length) {
    return false;
  }
  const firstDigit = token.charCodeAt(i);
  if (firstDigit === 0x30 /* 0 */) {
    i += 1;
    if (i < token.length && isAsciiDigitChar(token.charCodeAt(i))) {
      return false;
    }
  } else if (firstDigit >= 0x31 && firstDigit <= 0x39) {
    i += 1;
    while (i < token.length && isAsciiDigitChar(token.charCodeAt(i))) {
      i += 1;
    }
  } else {
    return false;
  }
  if (i < token.length && token.charCodeAt(i) === 0x2e /* . */) {
    i += 1;
    if (i >= token.length || !isAsciiDigitChar(token.charCodeAt(i))) {
      return false;
    }
    while (i < token.length && isAsciiDigitChar(token.charCodeAt(i))) {
      i += 1;
    }
  }
  if (i < token.length && (token.charAt(i) === "e" || token.charAt(i) === "E")) {
    i += 1;
    if (i < token.length && (token.charAt(i) === "+" || token.charAt(i) === "-")) {
      i += 1;
    }
    if (i >= token.length || !isAsciiDigitChar(token.charCodeAt(i))) {
      return false;
    }
    while (i < token.length && isAsciiDigitChar(token.charCodeAt(i))) {
      i += 1;
    }
  }
  return i === token.length;
}

function isValidJsonPrimitiveToken(token: string): boolean {
  return (
    token === "true" ||
    token === "false" ||
    token === "null" ||
    isValidJsonNumberToken(token)
  );
}

function skipJsonValue(text: string, start: number): number {
  const idx = skipWs(text, start);
  if (idx >= text.length) {
    return -1;
  }
  const ch = text.charAt(idx);
  if (ch === '"') {
    const str = parseJsonStringToken(text, idx);
    return str === null ? -1 : str.nextIndex;
  }
  if (ch === "{" || ch === "[") {
    const stack: string[] = [ch];
    let i = idx + 1;
    while (i < text.length && stack.length > 0) {
      const c = text.charAt(i);
      if (c === '"') {
        const str = parseJsonStringToken(text, i);
        if (str === null) {
          return -1;
        }
        i = str.nextIndex;
        continue;
      }
      if (c === "{" || c === "[") {
        stack.push(c);
      } else if (c === "}") {
        if (stack.pop() !== "{") {
          return -1;
        }
      } else if (c === "]") {
        if (stack.pop() !== "[") {
          return -1;
        }
      }
      i += 1;
    }
    return stack.length === 0 ? i : -1;
  }
  let i = idx;
  while (i < text.length) {
    const c = text.charAt(i);
    if (isJsonWhitespace(c) || c === "," || c === "}" || c === "]") {
      break;
    }
    i += 1;
  }
  if (i <= idx) {
    return -1;
  }
  return isValidJsonPrimitiveToken(text.slice(idx, i)) ? i : -1;
}

/**
 * Linear-time streaming scanner that extracts top-level JSON object keys in wire order (`04` §2.1 rule 5).
 * Returns `null` if the input is not a syntactically valid top-level JSON object or contains duplicate keys.
 */
export function extractTopLevelJsonKeys(rawJson: string): string[] | null {
  let i = skipWs(rawJson, 0);
  if (rawJson.charAt(i) !== "{") {
    return null;
  }
  i = skipWs(rawJson, i + 1);
  if (i >= rawJson.length) {
    return null;
  }
  const keys: string[] = [];
  const seen = new Set<string>();
  if (rawJson.charAt(i) === "}") {
    i = skipWs(rawJson, i + 1);
    return i === rawJson.length ? keys : null;
  }

  while (i < rawJson.length) {
    const keyTok = parseJsonStringToken(rawJson, i);
    if (keyTok === null || seen.has(keyTok.value)) {
      return null;
    }
    seen.add(keyTok.value);
    keys.push(keyTok.value);

    i = skipWs(rawJson, keyTok.nextIndex);
    if (rawJson.charAt(i) !== ":") {
      return null;
    }
    const afterVal = skipJsonValue(rawJson, i + 1);
    if (afterVal === -1) {
      return null;
    }
    i = skipWs(rawJson, afterVal);
    const sep = rawJson.charAt(i);
    if (sep === ",") {
      i = skipWs(rawJson, i + 1);
      continue;
    }
    if (sep === "}") {
      const end = skipWs(rawJson, i + 1);
      return end === rawJson.length ? keys : null;
    }
    return null;
  }
  return null;
}

/**
 * Verifies that top-level keys in raw JSON text appear in the exact required schema prefix order (`04` §2.1 rule 5).
 */
export function checkTopLevelKeyOrder(
  rawJson: string,
  expectedOrder: readonly string[]
): boolean {
  const keys = extractTopLevelJsonKeys(rawJson);
  if (keys === null || keys.length !== expectedOrder.length) {
    return false;
  }
  for (let i = 0; i < expectedOrder.length; i += 1) {
    if (keys[i] !== expectedOrder[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Parses raw JSON text, enforces top-level key prefix order (`04` §2.1 rule 5), and validates against `SCHEMAS[schemaId]`.
 */
export function parseAndValidateAiOutput<K extends SchemaId>(
  schemaId: K,
  rawJson: string
): ParseAiOutputResult<AiSchemaOutputMap[K]> {
  const schema = SCHEMAS[schemaId];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid JSON";
    return { ok: false, error: "PARSE", details: [msg] };
  }

  const keys = extractTopLevelJsonKeys(rawJson);
  if (keys === null) {
    return {
      ok: false,
      error: "KEY_ORDER",
      details: ["Top-level JSON value must be an object without duplicate keys"],
    };
  }
  if (!checkTopLevelKeyOrder(rawJson, schema.required)) {
    return {
      ok: false,
      error: "KEY_ORDER",
      details: [
        `Expected key order [${schema.required.join(", ")}], received [${keys.join(", ")}]`,
      ],
    };
  }

  const validation = validateJsonSchema(schema, parsed);
  if (!validation.ok) {
    return {
      ok: false,
      error: "SCHEMA",
      details: validation.errors.map((e) => `${e.path}: ${e.message}`),
    };
  }

  return { ok: true, data: parsed as AiSchemaOutputMap[K] };
}
