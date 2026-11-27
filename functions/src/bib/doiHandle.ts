import { normalizeDoi } from "./mismatch.js";
import type { UpstreamFetchFn } from "./openalex.js";

export type DoiHandleStatus = "DOI_NOT_FOUND" | "NOT_INDEXED" | "UPSTREAM_UNAVAILABLE";

export interface DoiHandleOptions {
  readonly fetchFn: UpstreamFetchFn;
  readonly acquireRateToken: () => Promise<void>;
  /** `VERIFY-AT-SPIKE BE-4`: handle API (`true`) vs HEAD manual-redirect fallback (`false`, default). */
  readonly spike_be_4_primary?: boolean;
}

/**
 * Verifies whether an explicit DOI absent from all bibliographic indexes is registered (`05` §3.1 step 6):
 * - Primary (`spike_be_4_primary = true`): Handle API `1`/`200` -> `NOT_INDEXED`, `100` -> `DOI_NOT_FOUND`
 * - Fallback (`spike_be_4_primary = false`, default): `HEAD https://doi.org/{encoded}` (`redirect: "manual"`)
 *   `404` -> `DOI_NOT_FOUND`, `301`/`302`/`303` -> `NOT_INDEXED`
 * - Anything else or network error -> `UPSTREAM_UNAVAILABLE`
 */
export async function checkDoiHandle(
  rawDoi: string,
  opts: DoiHandleOptions
): Promise<DoiHandleStatus> {
  const doi = normalizeDoi(rawDoi);
  const usePrimary = opts.spike_be_4_primary ?? false;
  try {
    await opts.acquireRateToken();
    if (!usePrimary) {
      const res = await opts.fetchFn(`https://doi.org/${encodeURIComponent(doi)}`, {
        method: "HEAD",
        redirect: "manual",
      });
      if (res.status === 404) return "DOI_NOT_FOUND";
      if (res.status === 301 || res.status === 302 || res.status === 303) return "NOT_INDEXED";
      return "UPSTREAM_UNAVAILABLE";
    }

    const res = await opts.fetchFn(`https://doi.org/api/handles/${encodeURIComponent(doi)}`, {
      method: "GET",
    });
    if (!res.ok && res.status !== 404) {
      return "UPSTREAM_UNAVAILABLE";
    }
    const body = (await res.json()) as { responseCode?: unknown };
    const code = body.responseCode;
    if (code === 1 || code === 200) return "NOT_INDEXED";
    if (code === 100) return "DOI_NOT_FOUND";
    return "UPSTREAM_UNAVAILABLE";
  } catch {
    return "UPSTREAM_UNAVAILABLE";
  }
}
