import { isIPv4, isIPv6 } from "node:net";

export interface RawRequestWithIp {
  readonly headers?: Record<string, string | string[] | undefined> | undefined;
  readonly ip?: string | undefined;
}

export interface ClientIpOptions {
  /**
   * Number of hops appended from the right of `X-Forwarded-For` by Google's load balancer (`BE-1`).
   * Default `1` selects the right-most entry added by Google's front end, never index 0.
   */
  readonly trustedProxyHopsFromRight?: number;
}

function getHeaderCaseInsensitive(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      if (Array.isArray(v)) {
        return v.join(",");
      }
      return v;
    }
  }
  return undefined;
}

function stripPortAndBrackets(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("[")) {
    const closeIdx = trimmed.indexOf("]");
    if (closeIdx !== -1) {
      return trimmed.slice(1, closeIdx);
    }
  }

  // IPv4 with :port (exactly one colon)
  const firstColon = trimmed.indexOf(":");
  if (firstColon !== -1 && firstColon === trimmed.lastIndexOf(":")) {
    const hostPart = trimmed.slice(0, firstColon);
    if (isIPv4(hostPart)) {
      return hostPart;
    }
  }

  return trimmed;
}

function stripZoneId(ip: string): string {
  const pctIdx = ip.indexOf("%");
  return pctIdx === -1 ? ip : ip.slice(0, pctIdx);
}

/**
 * Extracts the client IP from Google's front-end-appended `X-Forwarded-For` entry from the right (`BE-1`).
 * Never uses the client-controlled left-most entry when `X-Forwarded-For` is present.
 */
export function extractClientIp(
  rawRequest: RawRequestWithIp | undefined,
  options?: ClientIpOptions
): string | null {
  const hops = options?.trustedProxyHopsFromRight ?? 1;
  if (!Number.isInteger(hops) || hops < 1) {
    throw new Error(`trustedProxyHopsFromRight must be a positive integer, received ${hops}`);
  }

  const xff = getHeaderCaseInsensitive(rawRequest?.headers, "x-forwarded-for");
  if (xff !== undefined) {
    const entries = xff
      .split(",")
      .map((part) => stripZoneId(stripPortAndBrackets(part)))
      .filter((part) => part.length > 0);
    if (entries.length >= hops) {
      const candidate = entries[entries.length - hops];
      if (candidate && (isIPv4(candidate) || isIPv6(candidate))) {
        return candidate;
      }
    }
  }

  if (rawRequest?.ip) {
    const fallback = stripZoneId(stripPortAndBrackets(rawRequest.ip));
    if (isIPv4(fallback) || isIPv6(fallback)) {
      return fallback;
    }
  }

  return null;
}

function expandIpv6Hextets(ip: string): number[] | null {
  const lower = stripZoneId(ip).toLowerCase();
  if (!isIPv6(lower)) return null;

  const doubleColonParts = lower.split("::");
  if (doubleColonParts.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (side === "") return [];
    const tokens = side.split(":");
    const result: number[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const tok = tokens[i]!;
      if (tok.includes(".")) {
        if (i !== tokens.length - 1 || !isIPv4(tok)) {
          return null;
        }
        const octets = tok.split(".").map((n) => Number(n));
        result.push((octets[0]! << 8) | octets[1]!);
        result.push((octets[2]! << 8) | octets[3]!);
      } else {
        if (tok.length < 1 || tok.length > 4) return null;
        const val = Number.parseInt(tok, 16);
        if (!Number.isFinite(val) || val < 0 || val > 0xffff) return null;
        result.push(val);
      }
    }
    return result;
  };

  if (doubleColonParts.length === 1) {
    const full = parseSide(doubleColonParts[0]!);
    return full && full.length === 8 ? full : null;
  }

  const left = parseSide(doubleColonParts[0]!);
  const right = parseSide(doubleColonParts[1]!);
  if (!left || !right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...Array<number>(missing).fill(0), ...right];
}

/**
 * Normalizes an IPv4 address to `/24` (`a.b.c.0/24`) or IPv6 address to canonical `/48` (`xxxx:yyyy:zzzz::/48`).
 * IPv4-mapped IPv6 addresses (`::ffff:0:0/96`) normalize to the underlying IPv4 `/24`.
 */
export function normalizeIpPrefix(ip: string): string {
  const cleaned = stripZoneId(stripPortAndBrackets(ip));
  if (isIPv4(cleaned)) {
    const octets = cleaned.split(".");
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }

  const hextets = expandIpv6Hextets(cleaned);
  if (!hextets) {
    throw new Error(`Invalid IP address: ${ip}`);
  }

  // Unwrap IPv4-mapped IPv6 ::ffff:a.b.c.d
  if (
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0xffff
  ) {
    const a = (hextets[6]! >> 8) & 0xff;
    const b = hextets[6]! & 0xff;
    const c = (hextets[7]! >> 8) & 0xff;
    return `${a}.${b}.${c}.0/24`;
  }

  const h0 = hextets[0]!.toString(16).padStart(4, "0");
  const h1 = hextets[1]!.toString(16).padStart(4, "0");
  const h2 = hextets[2]!.toString(16).padStart(4, "0");
  return `${h0}:${h1}:${h2}::/48`;
}

/**
 * Combines `extractClientIp` and `normalizeIpPrefix`. Returns `null` if no valid IP is available.
 */
export function extractClientNetworkPrefix(
  rawRequest: RawRequestWithIp | undefined,
  options?: ClientIpOptions
): string | null {
  const ip = extractClientIp(rawRequest, options);
  if (!ip) return null;
  return normalizeIpPrefix(ip);
}
