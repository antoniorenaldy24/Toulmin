/**
 * Public Firebase client configuration (`05` §1, `04` §5.1.1).
 *
 * Contains public Web app metadata only — never secrets, server API keys,
 * App Check debug tokens, or hardcoded calendar dates (`00` §7.4).
 */

export interface FirebaseClientConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly storageBucket: string;
  readonly messagingSenderId: string;
  readonly appId: string;
}

export interface FirebaseRuntimeConfig {
  readonly firebaseConfig: FirebaseClientConfig;
  readonly recaptchaEnterpriseSiteKey: string;
  readonly functionsRegion: string;
}

function readPublicEnv(key: string): string {
  const metaEnv = (import.meta as unknown as { readonly env?: Readonly<Record<string, string | undefined>> }).env;
  if (metaEnv !== undefined) {
    const val = metaEnv[key];
    if (typeof val === "string") {
      return val;
    }
  }
  return "";
}

export const FIREBASE_CONFIG: FirebaseClientConfig = {
  apiKey: readPublicEnv("VITE_FIREBASE_API_KEY"),
  authDomain: readPublicEnv("VITE_FIREBASE_AUTH_DOMAIN") || "toulmin.web.app",
  projectId: readPublicEnv("VITE_FIREBASE_PROJECT_ID") || "toulmin-prod",
  storageBucket: readPublicEnv("VITE_FIREBASE_STORAGE_BUCKET") || "toulmin-prod.firebasestorage.app",
  messagingSenderId: readPublicEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: readPublicEnv("VITE_FIREBASE_APP_ID"),
};

export const RECAPTCHA_ENTERPRISE_SITE_KEY: string = readPublicEnv("VITE_RECAPTCHA_ENTERPRISE_SITE_KEY");

export const DEFAULT_FUNCTIONS_REGION = "us-central1" as const;

export function resolveRuntimeConfig(
  overrides?: Partial<{
    readonly firebaseConfig: Partial<FirebaseClientConfig>;
    readonly recaptchaEnterpriseSiteKey: string;
    readonly functionsRegion: string;
  }>
): FirebaseRuntimeConfig {
  return {
    firebaseConfig: {
      ...FIREBASE_CONFIG,
      ...(overrides?.firebaseConfig ?? {}),
    },
    recaptchaEnterpriseSiteKey:
      overrides?.recaptchaEnterpriseSiteKey ?? RECAPTCHA_ENTERPRISE_SITE_KEY,
    functionsRegion: overrides?.functionsRegion ?? DEFAULT_FUNCTIONS_REGION,
  };
}
