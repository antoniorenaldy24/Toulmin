/**
 * Structured safe logger (`05` §3.0 rule 4, AC-FN-10).
 * Emits only counts, hashes, latencies, and error classes; sensitive payload fields are redacted.
 */

export type SafeLogLevel = "info" | "warn" | "error";

export interface SafeLogRecord {
  readonly level: SafeLogLevel;
  readonly event: string;
  readonly timestamp: string;
  readonly fields: Record<string, unknown>;
}

export interface SafeLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const SENSITIVE_KEY_EXACT = new Set([
  "code",
  "judgecode",
  "title",
  "raw",
  "rawref",
  "rawreference",
  "claim",
  "claimtext",
  "claimhash",
  "claimhashes",
  "abstract",
  "text",
  "ip",
  "rawip",
  "xforwardedfor",
  "x-forwarded-for",
  "pepper",
  "secret",
  "token",
  "authorization",
]);

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (SENSITIVE_KEY_EXACT.has(normalized)) {
    return true;
  }
  return (
    normalized.includes("claimtext") ||
    normalized.includes("claimhash") ||
    normalized.includes("judgecode") ||
    normalized.includes("abstract") ||
    normalized.includes("rawref") ||
    normalized.includes("pepper") ||
    normalized.includes("secret") ||
    normalized.includes("forwardedfor")
  );
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }
  if (depth >= 4) {
    return "[TRUNCATED]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = sanitizeValue(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export function sanitizeLogFields(fields: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!fields) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (isSensitiveKey(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = sanitizeValue(v, 0);
    }
  }
  return out;
}

export function createSafeLogger(
  sink: (record: SafeLogRecord) => void = (record) => {
    const line = JSON.stringify(record);
    if (record.level === "error") {
      console.error(line);
    } else if (record.level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  },
  now: () => number = () => Date.now()
): SafeLogger {
  const emit = (level: SafeLogLevel, event: string, fields?: Record<string, unknown>): void => {
    sink({
      level,
      event,
      timestamp: new Date(now()).toISOString(),
      fields: sanitizeLogFields(fields),
    });
  };

  return {
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}

export const defaultLogger: SafeLogger = createSafeLogger();
