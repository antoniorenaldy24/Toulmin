import type { LookupAddress } from "node:dns";
import { lookup as dnsPromisesLookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";
import { Agent, request as undiciRequest } from "undici";

export const MAX_FETCH_BYTES = 25 * 1024 * 1024;
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
export const MAX_REDIRECTS = 3;

export type SafeFetchErrorCode =
  | "FORBIDDEN_SCHEME"
  | "FORBIDDEN_HOST"
  | "FORBIDDEN_IP"
  | "DNS_FAILED"
  | "TOO_MANY_REDIRECTS"
  | "SIZE_EXCEEDED"
  | "TIMEOUT"
  | "HTTP_ERROR";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly statusCode?: number;

  constructor(code: SafeFetchErrorCode, message: string, statusCode?: number) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
    if (statusCode !== undefined) {
      this.statusCode = statusCode;
    }
  }
}

export type DnsLookupFn = (hostname: string) => Promise<readonly LookupAddress[]>;

export interface SafeTransportResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: AsyncIterable<Uint8Array>;
}

export type SafeTransportFn = (params: {
  readonly url: string;
  readonly pinnedIp: string;
  readonly family: 4 | 6;
  readonly headers: Readonly<Record<string, string>>;
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}) => Promise<SafeTransportResponse>;

export interface SafeFetchOptions {
  readonly accept?: string;
  readonly userAgentMailto: string;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
  readonly dnsLookup?: DnsLookupFn;
  readonly transport?: SafeTransportFn;
}

export interface SafeFetchResponse {
  readonly finalUrl: string;
  readonly pinnedIp: string;
  readonly statusCode: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: Uint8Array;
}

function ipv4ToUint32(ip: string): number {
  const parts = ip.split(".").map((n) => Number(n));
  return (((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0);
}

function inIpv4Cidr(ipUint32: number, baseIp: string, prefixLen: number): boolean {
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ipUint32 & mask) === (ipv4ToUint32(baseIp) & mask);
}

function isForbiddenIpv4Uint32(v: number): boolean {
  return (
    inIpv4Cidr(v, "0.0.0.0", 8) ||
    inIpv4Cidr(v, "10.0.0.0", 8) ||
    inIpv4Cidr(v, "100.64.0.0", 10) ||
    inIpv4Cidr(v, "127.0.0.0", 8) ||
    inIpv4Cidr(v, "169.254.0.0", 16) ||
    inIpv4Cidr(v, "172.16.0.0", 12) ||
    inIpv4Cidr(v, "192.0.0.0", 24) ||
    inIpv4Cidr(v, "192.0.2.0", 24) ||
    inIpv4Cidr(v, "192.88.99.0", 24) ||
    inIpv4Cidr(v, "192.168.0.0", 16) ||
    inIpv4Cidr(v, "198.18.0.0", 15) ||
    inIpv4Cidr(v, "198.51.100.0", 24) ||
    inIpv4Cidr(v, "203.0.113.0", 24) ||
    inIpv4Cidr(v, "224.0.0.0", 4) ||
    inIpv4Cidr(v, "240.0.0.0", 4)
  );
}

function parseIpv6ToHextets(raw: string): number[] | null {
  const zoneIdx = raw.indexOf("%");
  const ip = (zoneIdx === -1 ? raw : raw.slice(0, zoneIdx)).toLowerCase();
  if (!isIPv6(ip)) return null;

  const parts = ip.split("::");
  if (parts.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const tokens = side.split(":");
    const out: number[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const tok = tokens[i]!;
      if (tok.includes(".")) {
        if (i !== tokens.length - 1 || !isIPv4(tok)) return null;
        const octets = tok.split(".").map((x) => Number(x));
        out.push((octets[0]! << 8) | octets[1]!);
        out.push((octets[2]! << 8) | octets[3]!);
      } else {
        if (tok.length < 1 || tok.length > 4) return null;
        const val = Number.parseInt(tok, 16);
        if (!Number.isFinite(val) || val < 0 || val > 0xffff) return null;
        out.push(val);
      }
    }
    return out;
  };

  if (parts.length === 1) {
    const full = parseSide(parts[0]!);
    return full && full.length === 8 ? full : null;
  }

  const left = parseSide(parts[0]!);
  const right = parseSide(parts[1]!);
  if (!left || !right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...Array<number>(missing).fill(0), ...right];
}

function hextetsToEmbeddedIpv4(hi: number, lo: number): number {
  return (((hi & 0xffff) << 16) | (lo & 0xffff)) >>> 0;
}

/**
 * Checks whether an IPv4 or IPv6 address falls in any RFC 6890 / transition forbidden range (`05` §3.2.3 step 2).
 */
export function isForbiddenIp(ip: string): boolean {
  const trimmed = ip.trim();
  if (isIPv4(trimmed)) {
    return isForbiddenIpv4Uint32(ipv4ToUint32(trimmed));
  }

  const h = parseIpv6ToHextets(trimmed);
  if (!h) {
    return true;
  }

  // ::/128 (unspecified) and ::1/128 (loopback)
  const first7Zero =
    h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0 && h[6] === 0;
  if (first7Zero && (h[7] === 0 || h[7] === 1)) {
    return true;
  }

  // ::ffff:0:0/96 (IPv4-mapped) -> also check embedded IPv4
  if (
    h[0] === 0 &&
    h[1] === 0 &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0xffff
  ) {
    return true; // Always forbidden (transition range; embedded IPv4 also forbidden)
  }

  // 64:ff9b::/96 (NAT64) and 64:ff9b:1::/48 (local-use NAT64)
  if (h[0] === 0x0064 && h[1] === 0xff9b) {
    if (h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
      return true;
    }
    if (h[2] === 0x0001) {
      return true;
    }
  }

  // 100::/64 (discard-only)
  if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) {
    return true;
  }

  // 2001::/32 (Teredo) and 2001:db8::/32 (documentation)
  if (h[0] === 0x2001 && (h[1] === 0 || h[1] === 0x0db8)) {
    return true;
  }

  // 2002::/16 (6to4; embedded IPv4 also checked, and the transition range itself is forbidden)
  if (h[0] === 0x2002) {
    const embedded = hextetsToEmbeddedIpv4(h[1]!, h[2]!);
    void isForbiddenIpv4Uint32(embedded);
    return true;
  }

  // fc00::/7 (unique local)
  if ((h[0]! & 0xfe00) === 0xfc00) {
    return true;
  }

  // fe80::/10 (link-local) and fec0::/10 (deprecated site-local)
  if ((h[0]! & 0xffc0) === 0xfe80 || (h[0]! & 0xffc0) === 0xfec0) {
    return true;
  }

  // ff00::/8 (multicast)
  if ((h[0]! & 0xff00) === 0xff00) {
    return true;
  }

  return false;
}

/**
 * Checks whether a hostname is forbidden (`05` §3.2.3 step 1).
 */
export function isForbiddenHost(hostname: string): boolean {
  let clean = hostname.trim().toLowerCase();
  while (clean.endsWith(".")) {
    clean = clean.slice(0, clean.length - 1);
  }
  if (!clean) return true;
  if (clean.startsWith("[") && clean.endsWith("]")) {
    clean = clean.slice(1, clean.length - 1);
  }
  if (
    clean === "metadata.google.internal" ||
    clean === "metadata" ||
    clean === "localhost" ||
    clean.endsWith(".internal") ||
    clean.endsWith(".local") ||
    clean.endsWith(".localhost")
  ) {
    return true;
  }
  if (isIPv4(clean) || isIPv6(clean)) {
    return isForbiddenIp(clean);
  }
  return false;
}

const defaultDnsLookup: DnsLookupFn = async (hostname: string) =>
  dnsPromisesLookup(hostname, { all: true, verbatim: true });

const defaultPinnedTransport: SafeTransportFn = async ({
  url,
  pinnedIp,
  family,
  headers,
  maxBytes,
  signal,
}) => {
  const parsed = new URL(url);
  const expectedHost = parsed.hostname.toLowerCase();

  const agent = new Agent({
    connect: {
      lookup: (lookupHostname, opts, callback) => {
        if (lookupHostname.toLowerCase() !== expectedHost) {
          callback(
            new SafeFetchError(
              "FORBIDDEN_HOST",
              `Unexpected DNS lookup host during pinned request: ${lookupHostname}`
            ),
            "",
            4
          );
          return;
        }
        if (typeof opts === "object" && opts !== null && opts.all) {
          callback(null, [{ address: pinnedIp, family }] as unknown as string, family);
          return;
        }
        callback(null, pinnedIp, family);
      },
    },
  });

  try {
    const res = await undiciRequest(url, {
      method: "GET",
      headers: { ...headers },
      dispatcher: agent,
      signal,
    });

    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of res.body) {
      const buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      total += buf.byteLength;
      if (total > maxBytes + 1) {
        res.body.destroy();
        throw new SafeFetchError(
          "SIZE_EXCEEDED",
          `Response exceeded ${maxBytes} byte limit`
        );
      }
      chunks.push(buf);
    }

    return {
      statusCode: res.statusCode,
      headers: res.headers as Record<string, string | string[] | undefined>,
      body: (async function* () {
        for (const c of chunks) {
          yield c;
        }
      })(),
    };
  } finally {
    await agent.close().catch(() => undefined);
  }
};

function getHeaderString(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      if (Array.isArray(v)) return v[0];
      return v;
    }
  }
  return undefined;
}

async function drainStream(body: AsyncIterable<Uint8Array>): Promise<void> {
  for await (const chunk of body) {
    void chunk;
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * SSRF-hardened HTTPS fetcher (`05` §3.2.3):
 * - `https:` only, no embedded URL credentials
 * - forbids metadata/internal/local hostnames
 * - resolves all A/AAAA records and rejects if ANY address is in a forbidden range
 * - pins the validated IP address inside `undici`'s `connect.lookup` (zero second resolution)
 * - follows at most 3 redirects, re-validating and re-pinning each hop
 * - sends ONLY `Accept` and `User-Agent: ToulminBot (mailto:...)`
 * - streams body up to 25 MB within a 30 s total fetch timeout
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions
): Promise<SafeFetchResponse> {
  const maxBytes = options.maxBytes ?? MAX_FETCH_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const dnsLookup = options.dnsLookup ?? defaultDnsLookup;
  const transport = options.transport ?? defaultPinnedTransport;

  const requestHeaders: Record<string, string> = {
    Accept: options.accept ?? "application/pdf, application/xml, text/xml, */*;q=0.8",
    "User-Agent": `ToulminBot (mailto:${options.userAgentMailto})`,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new SafeFetchError("TIMEOUT", "Fetch timed out")), timeoutMs);

  try {
    let currentUrl = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      let parsed: URL;
      try {
        parsed = new URL(currentUrl);
      } catch {
        throw new SafeFetchError("FORBIDDEN_SCHEME", `Invalid URL: ${currentUrl}`);
      }

      if (parsed.protocol !== "https:") {
        throw new SafeFetchError("FORBIDDEN_SCHEME", `Only https: is allowed, got ${parsed.protocol}`);
      }
      if (parsed.username || parsed.password) {
        throw new SafeFetchError("FORBIDDEN_HOST", "URL credentials are forbidden");
      }
      if (isForbiddenHost(parsed.hostname)) {
        throw new SafeFetchError("FORBIDDEN_HOST", `Forbidden host: ${parsed.hostname}`);
      }

      const hostLiteral = parsed.hostname.replace(/^\[|\]$/g, "");
      let addresses: readonly LookupAddress[];
      if (isIPv4(hostLiteral) || isIPv6(hostLiteral)) {
        addresses = [{ address: hostLiteral, family: isIPv6(hostLiteral) ? 6 : 4 }];
      } else {
        try {
          addresses = await dnsLookup(parsed.hostname);
        } catch (err) {
          throw new SafeFetchError(
            "DNS_FAILED",
            `DNS resolution failed for ${parsed.hostname}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      if (!addresses || addresses.length === 0) {
        throw new SafeFetchError("DNS_FAILED", `DNS returned no addresses for ${parsed.hostname}`);
      }

      for (const entry of addresses) {
        if (isForbiddenIp(entry.address)) {
          throw new SafeFetchError(
            "FORBIDDEN_IP",
            `Forbidden resolved address ${entry.address} for ${parsed.hostname}`
          );
        }
      }

      const chosen = addresses[0]!;
      const pinnedIp = chosen.address;
      const family: 4 | 6 = chosen.family === 6 ? 6 : 4;

      let res: SafeTransportResponse;
      try {
        res = await transport({
          url: parsed.toString(),
          pinnedIp,
          family,
          headers: requestHeaders,
          maxBytes,
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof SafeFetchError) throw err;
        if (controller.signal.aborted) {
          const reason = controller.signal.reason;
          if (reason instanceof SafeFetchError) throw reason;
          throw new SafeFetchError("TIMEOUT", "Fetch aborted due to timeout");
        }
        throw new SafeFetchError(
          "HTTP_ERROR",
          `Network fetch failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      if (isRedirectStatus(res.statusCode)) {
        await drainStream(res.body);
        if (hop >= maxRedirects) {
          throw new SafeFetchError(
            "TOO_MANY_REDIRECTS",
            `Exceeded maximum of ${maxRedirects} redirects`
          );
        }
        const loc = getHeaderString(res.headers, "location");
        if (!loc) {
          throw new SafeFetchError("HTTP_ERROR", `Redirect ${res.statusCode} missing Location`);
        }
        currentUrl = new URL(loc, parsed).toString();
        continue;
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        await drainStream(res.body);
        throw new SafeFetchError(
          "HTTP_ERROR",
          `Upstream returned HTTP ${res.statusCode}`,
          res.statusCode
        );
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      for await (const chunk of res.body) {
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          throw new SafeFetchError(
            "SIZE_EXCEEDED",
            `Response exceeded maximum size of ${maxBytes} bytes`
          );
        }
        chunks.push(chunk);
      }

      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const c of chunks) {
        combined.set(c, offset);
        offset += c.byteLength;
      }

      return {
        finalUrl: parsed.toString(),
        pinnedIp,
        statusCode: res.statusCode,
        headers: res.headers,
        body: combined,
      };
    }

    throw new SafeFetchError("TOO_MANY_REDIRECTS", `Exceeded maximum of ${maxRedirects} redirects`);
  } finally {
    clearTimeout(timer);
  }
}
