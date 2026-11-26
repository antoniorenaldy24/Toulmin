/**
 * Lazy, injectable Firebase client initialization (`04` §5.1.1, `05` §3.0, D-18).
 *
 * Zero network or SDK side effects occur on module import. App Check uses
 * ReCaptchaEnterpriseProvider (never debug providers/tokens), AI Logic uses
 * `useLimitedUseAppCheckTokens: true`, Remote Config fetch is never awaited at
 * boot, and `ensureAuth()` retries at most once before entering degraded mode.
 */

import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import {
  getAuth,
  getIdToken,
  getIdTokenResult,
  signInAnonymously,
  type Auth,
  type User,
} from "firebase/auth";
import {
  getAI,
  GoogleAIBackend,
  getGenerativeModel,
  type AI,
  type AIOptions,
  type GenerativeModel,
  type HybridParams,
  type ModelParams,
} from "firebase/ai";
import {
  fetchAndActivate,
  getBoolean as rcGetBoolean,
  getNumber as rcGetNumber,
  getRemoteConfig,
  getString as rcGetString,
  onConfigUpdate,
  type RemoteConfig,
} from "firebase/remote-config";
import { getFunctions, type Functions } from "firebase/functions";
import { EN_COPY } from "@toulmin/copy";
import { resolveRuntimeConfig, type FirebaseClientConfig, type FirebaseRuntimeConfig } from "./config.js";
import { BUNDLED_RC_DEFAULTS, type RemoteConfigReader } from "./rcDefaults.js";
import { classify, createTelemetry, type TelemetrySink } from "./telemetry.js";
import { createDegradedState, type DegradedStateController } from "./degraded.js";
import { createSessionCache, type SessionCache } from "./l1/sessionCache.js";

export interface FirebaseSdkAdapters {
  readonly initializeApp: (config: FirebaseClientConfig) => FirebaseApp;
  readonly initializeAppCheck: (app: FirebaseApp, siteKey: string) => AppCheck;
  readonly getAuth: (app: FirebaseApp) => Auth;
  readonly signInAnonymously: (auth: Auth) => Promise<unknown>;
  readonly getIdToken: (user: User, forceRefresh?: boolean) => Promise<string>;
  readonly getIdTokenResult: (
    user: User,
    forceRefresh?: boolean
  ) => Promise<{ readonly claims: Readonly<Record<string, unknown>> }>;
  readonly getAI: (app: FirebaseApp, options: AIOptions) => AI;
  readonly getGenerativeModel: (
    ai: AI,
    modelParams: ModelParams | HybridParams
  ) => GenerativeModel;
  readonly getRemoteConfig: (app: FirebaseApp) => RemoteConfig;
  readonly fetchAndActivate: (rc: RemoteConfig) => Promise<boolean>;
  readonly onConfigUpdate?: (
    rc: RemoteConfig,
    onUpdate: () => void
  ) => () => void;
  readonly getRcString: (rc: RemoteConfig, key: string) => string;
  readonly getRcNumber: (rc: RemoteConfig, key: string) => number;
  readonly getRcBoolean: (rc: RemoteConfig, key: string) => boolean;
  readonly getFunctions: (app: FirebaseApp, region: string) => Functions;
}

const DEFAULT_SDK_ADAPTERS: FirebaseSdkAdapters = {
  initializeApp: (config) => initializeApp(config),
  initializeAppCheck: (app, siteKey) =>
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    }),
  getAuth: (app) => getAuth(app),
  signInAnonymously: (auth) => signInAnonymously(auth),
  getIdToken: (user, forceRefresh) => getIdToken(user, forceRefresh),
  getIdTokenResult: (user, forceRefresh) => getIdTokenResult(user, forceRefresh),
  getAI: (app, options) => getAI(app, options),
  getGenerativeModel: (ai, modelParams) => getGenerativeModel(ai, modelParams),
  getRemoteConfig: (app) => getRemoteConfig(app),
  fetchAndActivate: (rc) => fetchAndActivate(rc),
  onConfigUpdate: (rc, onUpdate) =>
    onConfigUpdate(rc, {
      next: () => onUpdate(),
      error: () => {},
      complete: () => {},
    }),
  getRcString: (rc, key) => rcGetString(rc, key),
  getRcNumber: (rc, key) => rcGetNumber(rc, key),
  getRcBoolean: (rc, key) => rcGetBoolean(rc, key),
  getFunctions: (app, region) => getFunctions(app, region),
};

export interface CreateFirebaseRuntimeOptions {
  readonly config?: Partial<{
    readonly firebaseConfig: Partial<FirebaseClientConfig>;
    readonly recaptchaEnterpriseSiteKey: string;
    readonly functionsRegion: string;
  }>;
  readonly sdk?: Partial<FirebaseSdkAdapters>;
  readonly telemetry?: TelemetrySink;
  readonly degraded?: DegradedStateController;
  readonly sessionCache?: SessionCache;
  readonly isJudgeOverride?: () => boolean | Promise<boolean>;
  readonly nowSeconds?: () => number;
}

export interface FirebaseRuntime {
  readonly config: FirebaseRuntimeConfig;
  readonly app: FirebaseApp;
  readonly appCheck: AppCheck | null;
  readonly auth: Auth;
  readonly ai: AI;
  readonly rc: RemoteConfig;
  readonly rcReader: RemoteConfigReader;
  readonly functions: Functions;
  readonly telemetry: TelemetrySink;
  readonly degraded: DegradedStateController;
  readonly sessionCache: SessionCache;
  readonly modelRegistry: Map<string, GenerativeModel>;
  readonly sdk: FirebaseSdkAdapters;
  ensureAuth(): Promise<boolean>;
  retryDegradedRecovery(): Promise<boolean>;
  refreshIdToken(): Promise<string | null>;
  isJudge(): Promise<boolean>;
  dispose(): void;
}

export function createFirebaseRuntime(
  options?: CreateFirebaseRuntimeOptions
): FirebaseRuntime {
  const sdk: FirebaseSdkAdapters = {
    ...DEFAULT_SDK_ADAPTERS,
    ...(options?.sdk ?? {}),
  };
  const config = resolveRuntimeConfig(options?.config);
  const tel = options?.telemetry ?? createTelemetry();
  const deg = options?.degraded ?? createDegradedState();
  const cache = options?.sessionCache ?? createSessionCache();
  const modelRegistry = new Map<string, GenerativeModel>();

  const app = sdk.initializeApp(config.firebaseConfig);

  let appCheckInstance: AppCheck | null = null;
  const initAppCheck = (): AppCheck | null => {
    try {
      return sdk.initializeAppCheck(app, config.recaptchaEnterpriseSiteKey);
    } catch (e) {
      tel.record({ appCheckInitError: classify(e) });
      deg.set(EN_COPY.quota.degradedChip);
      return null;
    }
  };
  appCheckInstance = initAppCheck();

  const auth = sdk.getAuth(app);

  let authPromise: Promise<boolean> | null = null;
  let authRetried = false;

  const ensureAuth = (): Promise<boolean> => {
    if (auth.currentUser) {
      return Promise.resolve(true);
    }
    if (appCheckInstance === null) {
      return Promise.resolve(false);
    }
    authPromise ??= sdk.signInAnonymously(auth).then(
      () => {
        authPromise = null;
        return true;
      },
      (e) => {
        tel.record({ authError: classify(e) });
        authPromise = null;
        if (!authRetried) {
          authRetried = true;
          return ensureAuth();
        }
        deg.set(EN_COPY.quota.degradedChip);
        return false;
      }
    );
    return authPromise;
  };

  const retryDegradedRecovery = async (): Promise<boolean> => {
    if (appCheckInstance === null) {
      appCheckInstance = initAppCheck();
      if (appCheckInstance === null) {
        return false;
      }
    }
    authRetried = false;
    authPromise = null;
    const ok = await ensureAuth();
    if (ok) {
      deg.clear();
    }
    return ok;
  };

  // D-18: replay protection is enforced for Firebase AI Logic; always pass limited-use App Check tokens.
  const ai = sdk.getAI(app, {
    backend: new GoogleAIBackend(),
    useLimitedUseAppCheckTokens: true,
  });

  const rc = sdk.getRemoteConfig(app);
  rc.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
  rc.defaultConfig = { ...BUNDLED_RC_DEFAULTS };
  void sdk.fetchAndActivate(rc).catch(() => {});

  let unsubscribeConfig: (() => void) | undefined;
  if (sdk.onConfigUpdate) {
    try {
      unsubscribeConfig = sdk.onConfigUpdate(rc, () => {
        void sdk.fetchAndActivate(rc).catch(() => {});
      });
    } catch {
      // Real-time Remote Config listeners are optional when offline or unsupported.
    }
  }

  const rcReader: RemoteConfigReader = {
    getString(key: string): string {
      try {
        const val = sdk.getRcString(rc, key);
        if (val !== "") return val;
      } catch {
        // Fall through to bundled default.
      }
      const def = (BUNDLED_RC_DEFAULTS as Readonly<Record<string, string | number | boolean>>)[key];
      return def !== undefined ? String(def) : "";
    },
    getNumber(key: string): number {
      try {
        const val = sdk.getRcNumber(rc, key);
        if (Number.isFinite(val) && val !== 0) return val;
        // Distinguish explicit 0 from missing fallback using bundled defaults.
        const raw = sdk.getRcString(rc, key);
        if (raw !== "" && Number.isFinite(val)) return val;
      } catch {
        // Fall through to bundled default.
      }
      const def = (BUNDLED_RC_DEFAULTS as Readonly<Record<string, string | number | boolean>>)[key];
      return typeof def === "number" ? def : 0;
    },
    getBoolean(key: string): boolean {
      try {
        const raw = sdk.getRcString(rc, key);
        if (raw !== "") {
          return sdk.getRcBoolean(rc, key);
        }
      } catch {
        // Fall through to bundled default.
      }
      const def = (BUNDLED_RC_DEFAULTS as Readonly<Record<string, string | number | boolean>>)[key];
      return typeof def === "boolean" ? def : false;
    },
  };

  const functions = sdk.getFunctions(app, config.functionsRegion);

  const refreshIdToken = async (): Promise<string | null> => {
    const user = auth.currentUser;
    if (!user) {
      return null;
    }
    return sdk.getIdToken(user, true);
  };

  const nowSeconds = options?.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  const isJudge = async (): Promise<boolean> => {
    if (options?.isJudgeOverride) {
      return options.isJudgeOverride();
    }
    const user = auth.currentUser;
    if (!user) {
      return false;
    }
    try {
      const tokenResult = await sdk.getIdTokenResult(user, false);
      const claims = tokenResult.claims;
      const tier = claims["tier"];
      const tierExp = claims["tierExp"];
      if (tier !== "judge" || typeof tierExp !== "number") {
        return false;
      }
      return tierExp > nowSeconds();
    } catch {
      return false;
    }
  };

  return {
    config,
    app,
    get appCheck() {
      return appCheckInstance;
    },
    auth,
    ai,
    rc,
    rcReader,
    functions,
    telemetry: tel,
    degraded: deg,
    sessionCache: cache,
    modelRegistry,
    sdk,
    ensureAuth,
    retryDegradedRecovery,
    refreshIdToken,
    isJudge,
    dispose(): void {
      unsubscribeConfig?.();
      unsubscribeConfig = undefined;
    },
  };
}

let defaultRuntime: FirebaseRuntime | null = null;

export function getDefaultRuntime(): FirebaseRuntime {
  defaultRuntime ??= createFirebaseRuntime();
  return defaultRuntime;
}

export function setDefaultRuntimeForTest(runtime: FirebaseRuntime | null): void {
  defaultRuntime?.dispose();
  defaultRuntime = runtime;
}

export function ensureAuth(runtime: FirebaseRuntime = getDefaultRuntime()): Promise<boolean> {
  return runtime.ensureAuth();
}
