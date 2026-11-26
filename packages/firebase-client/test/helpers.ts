import type { FirebaseApp } from "firebase/app";
import type { AppCheck } from "firebase/app-check";
import type { Auth, User } from "firebase/auth";
import type {
  AI,
  AIOptions,
  GenerateContentResult,
  GenerateContentStreamResult,
  GenerativeModel,
  HybridParams,
  ModelParams,
} from "firebase/ai";
import type { Functions } from "firebase/functions";
import type { RemoteConfig } from "firebase/remote-config";
import {
  createFirebaseRuntime,
  type CreateFirebaseRuntimeOptions,
  type FirebaseRuntime,
  type FirebaseSdkAdapters,
} from "../src/firebase.js";

export interface RecordedModelCreation {
  readonly params: ModelParams | HybridParams;
  readonly model: GenerativeModel;
}

export interface FakeSdkHarness {
  readonly runtime: FirebaseRuntime;
  readonly createdModels: RecordedModelCreation[];
  readonly aiCalls: Array<{ readonly app: FirebaseApp; readonly options: AIOptions }>;
  readonly rcInstance: RemoteConfig;
  setRcValue(key: string, value: string | number | boolean): void;
  setCurrentUser(user: User | null): void;
  setSignInBehavior(fn: () => Promise<unknown>): void;
}

export function makeFakeModel(handlers?: {
  readonly initializeDeviceModel?: (cb?: (p: number) => void) => Promise<void>;
  readonly generateContent?: (req: unknown) => Promise<GenerateContentResult>;
  readonly generateContentStream?: (req: unknown) => Promise<GenerateContentStreamResult>;
}): GenerativeModel {
  return {
    initializeDeviceModel:
      handlers?.initializeDeviceModel ??
      (async () => {
        return;
      }),
    generateContent:
      handlers?.generateContent ??
      (async () => {
        throw new Error("Unexpected generateContent call");
      }),
    generateContentStream:
      handlers?.generateContentStream ??
      (async () => {
        throw new Error("Unexpected generateContentStream call");
      }),
  } as unknown as GenerativeModel;
}

export function createOfflineRuntimeHarness(
  opts?: {
    readonly sdkOverrides?: Partial<FirebaseSdkAdapters>;
    readonly runtimeOptions?: Omit<CreateFirebaseRuntimeOptions, "sdk">;
    readonly modelFactory?: (params: ModelParams | HybridParams) => GenerativeModel;
    readonly rcOverrides?: Record<string, string | number | boolean>;
  }
): FakeSdkHarness {
  const createdModels: RecordedModelCreation[] = [];
  const aiCalls: Array<{ readonly app: FirebaseApp; readonly options: AIOptions }> = [];
  const rcStore: Record<string, string | number | boolean> = { ...(opts?.rcOverrides ?? {}) };

  let currentUser: User | null = null;
  let signInFn: () => Promise<unknown> = async () => {
    currentUser = { uid: "anon-uid-1" } as unknown as User;
    return { user: currentUser };
  };

  const fakeApp = { name: "[DEFAULT]", options: {} } as unknown as FirebaseApp;
  const fakeAppCheck = { app: fakeApp } as unknown as AppCheck;
  const fakeAuth = {
    get currentUser() {
      return currentUser;
    },
  } as unknown as Auth;
  const rcInstance = {
    app: fakeApp,
    settings: { minimumFetchIntervalMillis: 43_200_000, fetchTimeoutMillis: 60_000 },
    defaultConfig: {},
    fetchTimeMillis: -1,
    lastFetchStatus: "no-fetch-yet",
  } as unknown as RemoteConfig;

  const sdk: FirebaseSdkAdapters = {
    initializeApp: () => fakeApp,
    initializeAppCheck: () => fakeAppCheck,
    getAuth: () => fakeAuth,
    signInAnonymously: () => signInFn(),
    getIdToken: async () => "fake-id-token",
    getIdTokenResult: async () => ({ claims: {} }),
    getAI: (app, options) => {
      aiCalls.push({ app, options });
      return { app, backend: options.backend!, options, location: "us-central1" } as unknown as AI;
    },
    getGenerativeModel: (_ai, params) => {
      const model = opts?.modelFactory ? opts.modelFactory(params) : makeFakeModel();
      createdModels.push({ params, model });
      return model;
    },
    getRemoteConfig: () => rcInstance,
    fetchAndActivate: async () => true,
    getRcString: (rc, key) => {
      if (key in rcStore) return String(rcStore[key]);
      if (key in rc.defaultConfig) return String(rc.defaultConfig[key]);
      return "";
    },
    getRcNumber: (rc, key) => {
      const val = key in rcStore ? rcStore[key] : rc.defaultConfig[key];
      return typeof val === "number" ? val : Number(val ?? 0);
    },
    getRcBoolean: (rc, key) => {
      const val = key in rcStore ? rcStore[key] : rc.defaultConfig[key];
      if (typeof val === "boolean") return val;
      return String(val).toLowerCase() === "true";
    },
    getFunctions: (_app, region) =>
      ({ app: fakeApp, region, customDomain: null }) as unknown as Functions,
    ...(opts?.sdkOverrides ?? {}),
  };

  const runtime = createFirebaseRuntime({
    config: {
      firebaseConfig: { projectId: "toulmin-test" },
      recaptchaEnterpriseSiteKey: "test-recaptcha-site-key",
    },
    ...(opts?.runtimeOptions ?? {}),
    sdk,
  });

  return {
    runtime,
    createdModels,
    aiCalls,
    rcInstance,
    setRcValue(key, value) {
      rcStore[key] = value;
    },
    setCurrentUser(user) {
      currentUser = user;
    },
    setSignInBehavior(fn) {
      signInFn = fn;
    },
  };
}
