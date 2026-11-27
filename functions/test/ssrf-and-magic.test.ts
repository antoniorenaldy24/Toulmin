import { describe, expect, it } from "vitest";
import { detectMagicBytes } from "../src/net/magic.js";
import {
  MAX_FETCH_BYTES,
  SafeFetchError,
  isForbiddenHost,
  isForbiddenIp,
  safeFetch,
} from "../src/net/safeFetch.js";

async function* chunksOf(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

describe("SSRF guard & pinned-IP safeFetch (05 §3.2.3, AC-FN-05)", () => {
  it("blocks every forbidden IPv4/IPv6 CIDR and transition range", () => {
    const forbiddenIps = [
      "0.0.0.1",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.0.0.1",
      "192.0.2.1",
      "192.88.99.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "::ffff:10.0.0.1",
      "64:ff9b::a00:1",
      "64:ff9b:1::1",
      "100::1",
      "2001::1",
      "2001:db8::1",
      "2002:0a00:0001::1",
      "fc00::1",
      "fe80::1",
      "fec0::1",
      "ff02::1",
    ];
    for (const ip of forbiddenIps) {
      expect(isForbiddenIp(ip), `expected ${ip} to be forbidden`).toBe(true);
    }

    const publicIps = ["93.184.216.34", "151.101.1.69", "2606:4700:4700::1111"];
    for (const ip of publicIps) {
      expect(isForbiddenIp(ip), `expected ${ip} to be allowed`).toBe(false);
    }
  });

  it("blocks forbidden hostnames and non-https schemes", async () => {
    expect(isForbiddenHost("metadata.google.internal")).toBe(true);
    expect(isForbiddenHost("metadata")).toBe(true);
    expect(isForbiddenHost("service.internal")).toBe(true);
    expect(isForbiddenHost("printer.local")).toBe(true);
    expect(isForbiddenHost("dev.localhost")).toBe(true);
    expect(isForbiddenHost("europepmc.org")).toBe(false);

    await expect(
      safeFetch("http://europepmc.org/test.pdf", { userAgentMailto: "ops@toulmin.example" })
    ).rejects.toMatchObject({ code: "FORBIDDEN_SCHEME" });

    await expect(
      safeFetch("https://metadata.google.internal/computeMetadata/v1/", {
        userAgentMailto: "ops@toulmin.example",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN_HOST" });
  });

  it("rejects DNS resolving to ANY forbidden IP (anti-DNS-rebinding) and pins IP on connect", async () => {
    await expect(
      safeFetch("https://rebind.example.org/paper.pdf", {
        userAgentMailto: "ops@toulmin.example",
        dnsLookup: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.1", family: 4 },
        ],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN_IP" });

    let observedPinnedIp = "";
    let observedHeaders: Readonly<Record<string, string>> = {};
    const resp = await safeFetch("https://cdn.example.org/paper.pdf", {
      userAgentMailto: "ops@toulmin.example",
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      transport: async ({ pinnedIp, headers }) => {
        observedPinnedIp = pinnedIp;
        observedHeaders = headers;
        return {
          statusCode: 200,
          headers: {},
          body: chunksOf(new TextEncoder().encode("%PDF-1.7")),
        };
      },
    });
    expect(observedPinnedIp).toBe("93.184.216.34");
    expect(resp.pinnedIp).toBe("93.184.216.34");
    expect(Object.keys(observedHeaders).sort()).toEqual(["Accept", "User-Agent"]);
    expect(observedHeaders["User-Agent"]).toBe("ToulminBot (mailto:ops@toulmin.example)");
  });

  it("allows up to 3 redirects, re-validates & re-pins each hop, and rejects the 4th redirect", async () => {
    const hopIps: string[] = [];
    const okRes = await safeFetch("https://hop0.example.org/start", {
      userAgentMailto: "ops@toulmin.example",
      dnsLookup: async (host) => {
        if (host === "hop0.example.org") return [{ address: "93.184.216.10", family: 4 }];
        if (host === "hop1.example.org") return [{ address: "93.184.216.11", family: 4 }];
        if (host === "hop2.example.org") return [{ address: "93.184.216.12", family: 4 }];
        return [{ address: "93.184.216.13", family: 4 }];
      },
      transport: async ({ url, pinnedIp }) => {
        hopIps.push(pinnedIp);
        if (url.includes("hop0")) {
          return { statusCode: 302, headers: { location: "https://hop1.example.org/1" }, body: chunksOf(new Uint8Array()) };
        }
        if (url.includes("hop1")) {
          return { statusCode: 302, headers: { location: "https://hop2.example.org/2" }, body: chunksOf(new Uint8Array()) };
        }
        if (url.includes("hop2")) {
          return { statusCode: 302, headers: { location: "https://hop3.example.org/final" }, body: chunksOf(new Uint8Array()) };
        }
        return { statusCode: 200, headers: {}, body: chunksOf(new TextEncoder().encode("%PDF-1.7")) };
      },
    });
    expect(okRes.finalUrl).toBe("https://hop3.example.org/final");
    expect(hopIps).toEqual(["93.184.216.10", "93.184.216.11", "93.184.216.12", "93.184.216.13"]);

    // 4th redirect fails with TOO_MANY_REDIRECTS
    await expect(
      safeFetch("https://loop.example.org/0", {
        userAgentMailto: "ops@toulmin.example",
        dnsLookup: async () => [{ address: "93.184.216.10", family: 4 }],
        transport: async () => ({
          statusCode: 302,
          headers: { location: "https://loop.example.org/next" },
          body: chunksOf(new Uint8Array()),
        }),
      })
    ).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });

    // Redirect to metadata IP fails with FORBIDDEN_HOST
    await expect(
      safeFetch("https://evil.example.org/start", {
        userAgentMailto: "ops@toulmin.example",
        dnsLookup: async () => [{ address: "93.184.216.10", family: 4 }],
        transport: async () => ({
          statusCode: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data" },
          body: chunksOf(new Uint8Array()),
        }),
      })
    ).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("enforces max byte cap (25 MB default) and detects magic bytes ignoring Content-Type", async () => {
    expect(MAX_FETCH_BYTES).toBe(25 * 1024 * 1024);

    await expect(
      safeFetch("https://big.example.org/big.pdf", {
        userAgentMailto: "ops@toulmin.example",
        maxBytes: 10,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        transport: async () => ({
          statusCode: 200,
          headers: {},
          body: chunksOf(new Uint8Array(11)),
        }),
      })
    ).rejects.toMatchObject({ code: "SIZE_EXCEEDED" });

    expect(detectMagicBytes(new TextEncoder().encode("%PDF-1.7\n"))).toBe("PDF");
    expect(detectMagicBytes(new TextEncoder().encode("  <?xml version=\"1.0\"?><article/>"))).toBe("XML");
    expect(detectMagicBytes(new TextEncoder().encode("<article xmlns=\"http://jats.nlm.nih.gov\">"))).toBe("XML");
    expect(detectMagicBytes(new TextEncoder().encode("<html><body>Not a PDF</body></html>"))).toBeNull();
  });
});
