import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import { rejectReplay } from "../src/common/appcheck.js";
import {
  extractClientIp,
  extractClientNetworkPrefix,
  normalizeIpPrefix,
} from "../src/common/clientIp.js";
import {
  CORS,
  addDays,
  jakartaDayStartMs,
  nextJakartaMidnightMs,
  resolveCors,
  yyyymmdd,
} from "../src/common/config.js";
import { createSafeLogger, type SafeLogRecord } from "../src/common/log.js";

function findFirstStatementTextOfConsumingHandler(sourceText: string): string | null {
  const sf = ts.createSourceFile("inline.ts", sourceText, ts.ScriptTarget.ES2022, true);
  let firstStmt: string | null = null;

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "onCall" &&
      node.arguments.length >= 2
    ) {
      const opts = node.arguments[0]!;
      const handler = node.arguments[1]!;
      if (opts.getText(sf).includes("CONSUMING") && ts.isArrowFunction(handler)) {
        if (ts.isBlock(handler.body) && handler.body.statements.length > 0) {
          firstStmt = handler.body.statements[0]!.getText(sf).trim();
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return firstStmt;
}

function findFirstStatementTextOfCreateHandler(sourceText: string): string | null {
  const sf = ts.createSourceFile("inline.ts", sourceText, ts.ScriptTarget.ES2022, true);
  let firstStmt: string | null = null;

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text.startsWith("create") && node.body) {
      for (const stmt of node.body.statements) {
        if (ts.isReturnStatement(stmt) && stmt.expression && ts.isArrowFunction(stmt.expression)) {
          const inner = stmt.expression.body;
          if (ts.isBlock(inner) && inner.statements.length > 0) {
            firstStmt = inner.statements[0]!.getText(sf).trim();
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return firstStmt;
}

describe("App Check replay rejection (AC-SEC-02)", () => {
  it("static AST check: rejectReplay(request) is the first statement of every CONSUMING handler", () => {
    const files = [
      resolve(import.meta.dirname, "../src/quota/quotaGuard.ts"),
      resolve(import.meta.dirname, "../src/judge/redeemJudgeCode.ts"),
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(findFirstStatementTextOfConsumingHandler(src)).toBe("rejectReplay(request);");
      expect(findFirstStatementTextOfCreateHandler(src)).toBe("rejectReplay(request);");
    }
  });

  it("rejects consumed App Check tokens with permission-denied: REPLAYED_TOKEN", () => {
    try {
      rejectReplay({ app: { appId: "app-1", alreadyConsumed: true } });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpsError);
      expect((err as HttpsError).code).toBe("permission-denied");
      expect((err as HttpsError).message).toBe("REPLAYED_TOKEN");
    }
  });

  it("rejects missing App Check context with failed-precondition: APP_CHECK_REQUIRED", () => {
    try {
      rejectReplay({});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpsError);
      expect((err as HttpsError).code).toBe("failed-precondition");
      expect((err as HttpsError).message).toBe("APP_CHECK_REQUIRED");
    }
  });

  it("allows fresh unconsumed App Check tokens", () => {
    expect(() => rejectReplay({ app: { appId: "app-1", alreadyConsumed: false } })).not.toThrow();
  });
});

describe("BE-1 Client IP extraction & prefix normalization (AC-SEC-09)", () => {
  it("ignores client-forged left-most X-Forwarded-For entries and uses Google's right-most entry", () => {
    const realIp = "203.0.113.42";
    const forgedCases = [
      `198.51.100.7, ${realIp}`,
      `10.0.0.1, 172.16.0.5, ${realIp}`,
      `1.1.1.1, 8.8.8.8, 9.9.9.9, 4.2.2.1, 192.0.2.99, ${realIp}`,
      `[2001:db8::1], 127.0.0.1, ${realIp}`,
    ];
    for (const header of forgedCases) {
      const extracted = extractClientIp({
        headers: { "X-Forwarded-For": header },
        ip: "127.0.0.1",
      });
      expect(extracted).toBe(realIp);
      expect(
        extractClientNetworkPrefix({ headers: { "x-forwarded-for": header }, ip: "127.0.0.1" })
      ).toBe("203.0.113.0/24");
    }
  });

  it("supports configurable trustedProxyHopsFromRight if BE-1 specifies hop count > 1", () => {
    const ip = extractClientIp(
      {
        headers: { "x-forwarded-for": "1.2.3.4, 198.51.100.88, 10.128.0.5" },
      },
      { trustedProxyHopsFromRight: 2 }
    );
    expect(ip).toBe("198.51.100.88");
  });

  it("normalizes IPv4 to /24, IPv4-mapped IPv6 to /24, and IPv6 to canonical /48", () => {
    expect(normalizeIpPrefix("198.51.100.219")).toBe("198.51.100.0/24");
    expect(normalizeIpPrefix("::ffff:198.51.100.219")).toBe("198.51.100.0/24");
    expect(normalizeIpPrefix("2001:db8:abcd:0012::42")).toBe("2001:0db8:abcd::/48");
    expect(normalizeIpPrefix("2600:1901::1")).toBe("2600:1901:0000::/48");
  });
});

describe("CORS, Asia/Jakarta calendar day & safe logger (05 §3.0, §4.2, AC-FN-10)", () => {
  it("defaults production CORS exclusively to https://toulmin.web.app", () => {
    expect(CORS).toHaveLength(1);
    expect(CORS[0]!.test("https://toulmin.web.app")).toBe(true);
    expect(CORS[0]!.test("http://localhost:5173")).toBe(false);
    expect(CORS[0]!.test("https://toulmin.web.app.evil.com")).toBe(false);
    expect(resolveCors({})).toHaveLength(1);
    expect(
      resolveCors({ FUNCTIONS_EMULATOR: "true", TOULMIN_ALLOW_LOCALHOST_CORS: "true" })
    ).toHaveLength(2);
  });

  it("computes Asia/Jakarta YYYYMMDD and next 00:00 Asia/Jakarta midnight accurately", () => {
    // 2026-11-27T16:59:59Z = 2026-11-27T23:59:59+07:00
    const beforeMidnight = Date.UTC(2026, 10, 27, 16, 59, 59);
    // 2026-11-27T17:00:00Z = 2026-11-28T00:00:00+07:00
    const atMidnight = Date.UTC(2026, 10, 27, 17, 0, 0);

    expect(yyyymmdd(beforeMidnight)).toBe("20261127");
    expect(yyyymmdd(atMidnight)).toBe("20261128");
    expect(nextJakartaMidnightMs(beforeMidnight)).toBe(atMidnight);
    expect(jakartaDayStartMs("20261128")).toBe(atMidnight);
    expect(addDays("20261127", 3).getTime()).toBe(Date.UTC(2026, 10, 29, 17, 0, 0));
  });

  it("redacts sensitive fields in safe logger (AC-FN-10)", () => {
    const records: SafeLogRecord[] = [];
    const logger = createSafeLogger((r) => records.push(r), () => 1_700_000_000_000);
    logger.info("test.event", {
      uid: "u1",
      count: 5,
      latencyMs: 12,
      code: "TLMN-ABCD-EFGH",
      title: "Secret Manuscript Title",
      raw: "Raw bibliography entry",
      claimText: "Sensitive claim sentence",
      claimHashes: ["a".repeat(64)],
      abstract: "Confidential abstract",
      nested: {
        judgeCode: "TLMN-9999-8888",
        safeCount: 2,
      },
    });
    expect(records).toHaveLength(1);
    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain("TLMN-ABCD-EFGH");
    expect(serialized).not.toContain("Secret Manuscript Title");
    expect(serialized).not.toContain("Raw bibliography entry");
    expect(serialized).not.toContain("Sensitive claim sentence");
    expect(serialized).not.toContain("Confidential abstract");
    expect(serialized).not.toContain("TLMN-9999-8888");
    expect(records[0]!.fields["uid"]).toBe("u1");
    expect(records[0]!.fields["count"]).toBe(5);
  });
});
