import { applicationDefault, getApp, getApps, initializeApp } from "firebase-admin/app";
import { defineString } from "firebase-functions/params";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { PROD_PROJECT_ID, REGION, SERVICE_ACCOUNTS } from "../common/config.js";
import { defaultLogger, type SafeLogger } from "../common/log.js";
import { assertValidBudgetMessage } from "../common/validate.js";

const RECAPTCHA_ENTERPRISE_KEY_ID = defineString("RECAPTCHA_ENTERPRISE_KEY_ID", {
  default: "",
});

export interface RecaptchaKeyDisabler {
  disableWebKey(params: { readonly projectId: string; readonly keyId: string }): Promise<void>;
}

export interface RecaptchaBreakerDeps {
  readonly disabler: RecaptchaKeyDisabler;
  readonly getProjectId: () => string;
  readonly getKeyId: () => string;
  readonly logger?: SafeLogger;
}

export interface RecaptchaBreakerOutcome {
  readonly budgetDisplayName: string;
  readonly ratioRounded: string;
  readonly disabled: boolean;
}

/**
 * Production REST adapter disabling the Web reCAPTCHA Enterprise key via `projects.keys.patch`
 * using `ops-sa` (`roles/recaptchaenterprise.admin`, `05` §1.3, §3.5).
 */
export function createGoogleRecaptchaDisabler(
  fetchImpl: typeof fetch = fetch
): RecaptchaKeyDisabler {
  return {
    async disableWebKey({ projectId, keyId }): Promise<void> {
      if (!keyId) {
        throw new Error("RECAPTCHA_ENTERPRISE_KEY_ID parameter is not configured");
      }
      const tokenResult = await applicationDefault().getAccessToken();
      const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/keys/${encodeURIComponent(keyId)}?updateMask=webSettings.allowAllDomains,webSettings.allowedDomains`;
      const resp = await fetchImpl(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tokenResult.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          webSettings: {
            allowAllDomains: false,
            allowedDomains: [],
          },
        }),
      });
      if (!resp.ok) {
        throw new Error(`reCAPTCHA key disable failed with HTTP ${resp.status}`);
      }
    },
  };
}

export function createRecaptchaBreakerHandler(
  deps: RecaptchaBreakerDeps
): (payload: unknown) => Promise<RecaptchaBreakerOutcome> {
  const logger = deps.logger ?? defaultLogger;

  return async (payload: unknown): Promise<RecaptchaBreakerOutcome> => {
    const msg = assertValidBudgetMessage(payload);
    const ratio = msg.costAmount / msg.budgetAmount;
    const ratioRounded = ratio.toFixed(2);

    if (ratio >= 1.0) {
      await deps.disabler.disableWebKey({
        projectId: deps.getProjectId(),
        keyId: deps.getKeyId(),
      });
      logger.error("recaptchaBreaker.key_disabled", {
        budgetDisplayName: msg.budgetDisplayName,
        ratio: ratioRounded,
        disabled: true,
      });
      return {
        budgetDisplayName: msg.budgetDisplayName,
        ratioRounded,
        disabled: true,
      };
    }

    logger.info("recaptchaBreaker.below_threshold", {
      budgetDisplayName: msg.budgetDisplayName,
      ratio: ratioRounded,
      disabled: false,
    });
    return {
      budgetDisplayName: msg.budgetDisplayName,
      ratioRounded,
      disabled: false,
    };
  };
}

let cachedDefaultHandler: ((payload: unknown) => Promise<RecaptchaBreakerOutcome>) | null = null;

function getDefaultHandler(): (payload: unknown) => Promise<RecaptchaBreakerOutcome> {
  if (cachedDefaultHandler) return cachedDefaultHandler;
  const app = getApps().length > 0 ? getApp() : initializeApp();
  const projectId =
    app.options.projectId ??
    process.env["GOOGLE_CLOUD_PROJECT"] ??
    process.env["GCLOUD_PROJECT"] ??
    PROD_PROJECT_ID;
  cachedDefaultHandler = createRecaptchaBreakerHandler({
    disabler: createGoogleRecaptchaDisabler(),
    getProjectId: () => projectId,
    getKeyId: () => RECAPTCHA_ENTERPRISE_KEY_ID.value(),
  });
  return cachedDefaultHandler;
}

export const recaptchaBreaker = onMessagePublished(
  {
    topic: "recaptcha-alerts",
    region: REGION,
    maxInstances: 1,
    concurrency: 1,
    memory: "512MiB",
    cpu: 1,
    timeoutSeconds: 300,
    serviceAccount: SERVICE_ACCOUNTS.ops,
  },
  async (event) => {
    const payload = event.data.message.json;
    await getDefaultHandler()(payload);
  }
);
