/**
 * Trusted Types URL validators and policy registry (`05` §2.3, `00` §7.5, AC-SEC-04).
 *
 * Implements the four normative policies (`default`, `toulmin-html`, `toulmin-worker`,
 * `toulmin-loader`) with strict `new URL(...)` dot-segment normalization.
 */

import DOMPurify from "dompurify";

const ALLOWED_RECAPTCHA_ORIGINS = new Set<string>([
  "https://www.google.com",
  "https://www.gstatic.com",
]);

const SAME_ORIGIN_ASSET_RE = /^\/assets\/[A-Za-z0-9._-]+\.js$/;

export interface TrustedTypesPolicyRules {
  readonly createHTML?: (input: string) => string;
  readonly createScriptURL?: (input: string) => string;
  readonly createScript?: (input: string) => string;
}

export interface TrustedTypePolicyLike {
  readonly name?: string;
  createHTML?(input: string): unknown;
  createScriptURL?(input: string): unknown;
  createScript?(input: string): unknown;
}

export interface ToulminTrustedTypesRegistry {
  readonly default?: TrustedTypePolicyLike;
  readonly html?: TrustedTypePolicyLike;
  readonly worker?: TrustedTypePolicyLike;
  readonly loader?: TrustedTypePolicyLike;
}

export interface TrustedTypePolicyFactoryLike {
  createPolicy(name: string, policy: TrustedTypesPolicyRules): unknown;
}

declare global {
  interface Window {
    __toulminSanitizeHtml?: (dirtyHtml: string) => string;
    __toulminTrustedPolicies?: Readonly<ToulminTrustedTypesRegistry>;
  }
  var __toulminTrustedPolicies: Readonly<ToulminTrustedTypesRegistry> | undefined;
}

/**
 * Validates `script.src` URLs under the `default` Trusted Types policy (`05` §2.3).
 *
 * Parses via `new URL(input)` (resolving dot segments) and permits ONLY:
 * - `https:` protocol, empty username & password
 * - origin in `{"https://www.google.com", "https://www.gstatic.com"}`
 * - `pathname` starting with `"/recaptcha/"`
 */
export function validateRecaptchaScriptUrl(input: string): string {
  const parsed = new URL(input);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !ALLOWED_RECAPTCHA_ORIGINS.has(parsed.origin) ||
    !parsed.pathname.startsWith("/recaptcha/")
  ) {
    throw new TypeError(`Blocked untrusted script URL under default policy: ${parsed.origin}`);
  }
  return parsed.href;
}

/**
 * Validates same-origin Vite bundle / Web Worker asset script URLs (`05` §2.3).
 *
 * Parses via `new URL(input, baseOrigin)` (resolving dot segments) and permits ONLY
 * same-origin paths matching `^/assets/[A-Za-z0-9._-]+\.js$`.
 */
export function validateSameOriginAssetUrl(input: string, baseOrigin: string): string {
  const parsed = new URL(input, baseOrigin);
  if (parsed.origin !== baseOrigin || !SAME_ORIGIN_ASSET_RE.test(parsed.pathname)) {
    throw new TypeError(`Blocked non-asset script URL: ${parsed.pathname}`);
  }
  return parsed.href;
}

/**
 * Returns `true` when `DOMPurify` is initialized with a DOM (`window` / `document`).
 */
export function isDomPurifyAvailable(): boolean {
  return typeof (DOMPurify as unknown as { sanitize?: unknown })?.sanitize === "function";
}

/**
 * Sanitizes an HTML string using pinned `DOMPurify` (`>= 3.2.4`, `RETURN_TRUSTED_TYPE: false`).
 */
export function sanitizeHtmlWithDomPurify(input: string): string {
  return DOMPurify.sanitize(input, { RETURN_TRUSTED_TYPE: false });
}

/**
 * Binds `DOMPurify` to the `toulmin-html` policy hook created by the inline bootstrap.
 */
export function bindDomPurifyHtmlSanitizer(): void {
  if (typeof globalThis.window !== "undefined") {
    globalThis.window.__toulminSanitizeHtml = sanitizeHtmlWithDomPurify;
  }
}

/**
 * Returns the frozen Trusted Types policy registry exposed by the inline bootstrap.
 */
export function getToulminTrustedPolicies(): Readonly<ToulminTrustedTypesRegistry> {
  return globalThis.__toulminTrustedPolicies ?? {};
}

/**
 * Returns the bootstrap-created `toulmin-worker` Trusted Types policy without creating duplicates.
 */
export function getToulminWorkerPolicy(): TrustedTypePolicyLike | null {
  return getToulminTrustedPolicies().worker ?? null;
}

/**
 * Returns the bootstrap-created `toulmin-html` Trusted Types policy without creating duplicates.
 */
export function getToulminHtmlPolicy(): TrustedTypePolicyLike | null {
  return getToulminTrustedPolicies().html ?? null;
}

/**
 * Produces a same-origin TrustedScriptURL (when Trusted Types are active) or validated URL
 * string for Vite module workers and the pdf.js worker via `toulmin-worker`.
 */
export function createTrustedWorkerScriptUrl(
  assetPath: string,
  baseOrigin: string = typeof globalThis.location !== "undefined"
    ? globalThis.location.origin
    : "https://localhost"
): unknown {
  const validated = validateSameOriginAssetUrl(assetPath, baseOrigin);
  const workerPolicy = getToulminWorkerPolicy();
  if (workerPolicy && typeof workerPolicy.createScriptURL === "function") {
    return workerPolicy.createScriptURL(validated);
  }
  return validated;
}

/**
 * Registers the four normative Trusted Types policies (`05` §2.3) in a host-injectable way,
 * returning the created policy handles so callers reuse them without duplicate creation.
 */
export function registerTrustedTypesPolicies(
  factory: TrustedTypePolicyFactoryLike,
  baseOrigin: string,
  sanitizeHtml: (dirtyHtml: string) => string = sanitizeHtmlWithDomPurify
): Record<"default" | "toulmin-html" | "toulmin-worker" | "toulmin-loader", TrustedTypePolicyLike> {
  const reject = (policyName: string, method: string) => (): never => {
    throw new TypeError(`${policyName}.${method} is not permitted`);
  };

  const definitions: Record<
    "default" | "toulmin-html" | "toulmin-worker" | "toulmin-loader",
    TrustedTypesPolicyRules
  > = {
    default: {
      createHTML: reject("default", "createHTML"),
      createScriptURL: (input: string) => validateRecaptchaScriptUrl(input),
      createScript: reject("default", "createScript"),
    },
    "toulmin-html": {
      createHTML: (input: string) => sanitizeHtml(input),
      createScriptURL: reject("toulmin-html", "createScriptURL"),
      createScript: reject("toulmin-html", "createScript"),
    },
    "toulmin-worker": {
      createHTML: reject("toulmin-worker", "createHTML"),
      createScriptURL: (input: string) => validateSameOriginAssetUrl(input, baseOrigin),
      createScript: reject("toulmin-worker", "createScript"),
    },
    "toulmin-loader": {
      createHTML: reject("toulmin-loader", "createHTML"),
      createScriptURL: (input: string) => validateSameOriginAssetUrl(input, baseOrigin),
      createScript: reject("toulmin-loader", "createScript"),
    },
  };

  const created = {} as Record<
    "default" | "toulmin-html" | "toulmin-worker" | "toulmin-loader",
    TrustedTypePolicyLike
  >;
  for (const name of ["default", "toulmin-html", "toulmin-worker", "toulmin-loader"] as const) {
    created[name] = factory.createPolicy(name, definitions[name]) as TrustedTypePolicyLike;
  }
  return created;
}

/**
 * Emits the self-contained inline bootstrap script placed inside built HTML under
 * `script-src 'sha256-BOOTSTRAP_HASH' 'strict-dynamic'` (`05` §2.2, §2.3).
 *
 * Captures and freezes created policy handles (`default`, `toulmin-html`, `toulmin-worker`,
 * `toulmin-loader`) onto `globalThis.__toulminTrustedPolicies` so runtime workers and
 * DOM sanitizers reuse them without duplicate `createPolicy()` calls.
 */
export function buildInlineBootstrapSource(entryAssetPath: string): string {
  const safePathLiteral = JSON.stringify(entryAssetPath);
  return `(function(){var tt=globalThis.trustedTypes;var o=location.origin;var assetRe=/^\\/assets\\/[A-Za-z0-9._-]+\\.js$/;var bad=function(m){throw new TypeError(m);};function checkRecaptcha(u){var p=new URL(u);if(p.protocol!=="https:"||p.username!==""||p.password!==""||(p.origin!=="https://www.google.com"&&p.origin!=="https://www.gstatic.com")||!p.pathname.startsWith("/recaptcha/")){throw new TypeError("Blocked script URL");}return p.href;}function checkAsset(u){var p=new URL(u,o);if(p.origin!==o||!assetRe.test(p.pathname)){throw new TypeError("Blocked asset URL");}return p.href;}var reg={};var loader=null;if(tt&&typeof tt.createPolicy==="function"){try{reg.default=tt.createPolicy("default",{createHTML:function(){bad("createHTML blocked");},createScriptURL:checkRecaptcha,createScript:function(){bad("createScript blocked");}});}catch(_e){}try{reg.html=tt.createPolicy("toulmin-html",{createHTML:function(s){var fn=globalThis.__toulminSanitizeHtml;if(typeof fn!=="function"){throw new TypeError("DOMPurify sanitizer not bound yet");}return fn(s);},createScriptURL:function(){bad("createScriptURL blocked");},createScript:function(){bad("createScript blocked");}});}catch(_e){}try{reg.worker=tt.createPolicy("toulmin-worker",{createHTML:function(){bad("createHTML blocked");},createScriptURL:checkAsset,createScript:function(){bad("createScript blocked");}});}catch(_e){}try{loader=tt.createPolicy("toulmin-loader",{createHTML:function(){bad("createHTML blocked");},createScriptURL:checkAsset,createScript:function(){bad("createScript blocked");}});reg.loader=loader;}catch(_e){}}try{Object.defineProperty(globalThis,"__toulminTrustedPolicies",{value:Object.freeze(reg),writable:false,configurable:false,enumerable:false});}catch(_e){globalThis.__toulminTrustedPolicies=Object.freeze(reg);}var s=document.createElement("script");s.type="module";var target=${safePathLiteral};s.src=loader?loader.createScriptURL(target):checkAsset(target);document.head.appendChild(s);})();`;
}
