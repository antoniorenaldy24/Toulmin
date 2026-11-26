/**
 * Web Chrome desktop environment checker and on-device readiness (`04` §5.1.2, D-26).
 */

import { EN_COPY } from "@toulmin/copy";

export type Readiness =
  | "unsupported"
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available";

export type EnvReason =
  | "NOT_CHROME"
  | "CHROME_TOO_OLD"
  | "API_MISSING"
  | "UNAVAILABLE_HARDWARE_OR_DISK"
  | "LANGUAGE_UNSUPPORTED";

export interface EnvReport {
  readonly readiness: Readiness;
  readonly chromeMajor: number | null;
  readonly reasons: EnvReason[];
}

export interface UserAgentBrandLike {
  readonly brand: string;
  readonly version: string;
}

export interface NavigatorLike {
  readonly userAgentData?: {
    readonly brands: readonly UserAgentBrandLike[];
  };
}

export interface LanguageModelLike {
  availability(options: {
    readonly expectedInputs: readonly { readonly type: string; readonly languages?: readonly string[] }[];
    readonly expectedOutputs: readonly { readonly type: string; readonly languages?: readonly string[] }[];
  }): Promise<string>;
}

export interface EnvironmentCheckDeps {
  readonly navigator?: NavigatorLike | undefined;
  readonly languageModel?: LanguageModelLike | undefined;
}

export async function checkEnvironment(deps?: EnvironmentCheckDeps): Promise<EnvReport> {
  const nav =
    deps?.navigator ??
    (typeof navigator !== "undefined" ? (navigator as unknown as NavigatorLike) : undefined);
  const ua = nav?.userAgentData;
  const chrome = ua?.brands.find((b) => b.brand === "Google Chrome");
  const parsedMajor = chrome ? Number(chrome.version) : null;
  const chromeMajor = parsedMajor !== null && Number.isFinite(parsedMajor) ? parsedMajor : null;

  const reasons: EnvReason[] = [];
  if (!chrome) {
    reasons.push("NOT_CHROME");
  } else if (chromeMajor !== null && chromeMajor < 148) {
    reasons.push("CHROME_TOO_OLD");
  }

  const lm =
    deps && "languageModel" in deps
      ? deps.languageModel
      : (globalThis as unknown as { readonly LanguageModel?: LanguageModelLike }).LanguageModel;

  if (!lm) {
    reasons.push("API_MISSING");
    return { readiness: "unsupported", chromeMajor, reasons };
  }

  try {
    const availability = await lm.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
    if (availability === "unavailable") {
      reasons.push("UNAVAILABLE_HARDWARE_OR_DISK");
    }
    return { readiness: availability as Readiness, chromeMajor, reasons };
  } catch {
    reasons.push("LANGUAGE_UNSUPPORTED");
    return { readiness: "unavailable", chromeMajor, reasons };
  }
}

export function formatEnvironmentReasons(reasons: readonly EnvReason[]): string[] {
  return reasons.map((reason) => EN_COPY.environment[reason]);
}
