/**
 * Shared Cloud Functions 2nd gen configuration, service accounts, CORS policy,
 * and Asia/Jakarta calendar day helpers (`05` §1.3, §3.0, §4.1–§4.2).
 */

export const REGION = "us-central1" as const;
export const PROD_PROJECT_ID = "toulmin-prod" as const;

// Anchored origin; emulator localhost is added ONLY via resolveCors() in explicit local emulator mode.
export const CORS: RegExp[] = [/^https:\/\/toulmin\.web\.app$/];
export const EMULATOR_LOCALHOST_CORS = /^http:\/\/localhost:\d+$/;

export function resolveCors(env: Record<string, string | undefined> = process.env): RegExp[] {
  if (env["FUNCTIONS_EMULATOR"] === "true" && env["TOULMIN_ALLOW_LOCALHOST_CORS"] === "true") {
    return [...CORS, EMULATOR_LOCALHOST_CORS];
  }
  return [...CORS];
}

export const BASE = {
  region: REGION,
  enforceAppCheck: true,
  cors: CORS,
} as const;

export const CONSUMING = {
  ...BASE,
  consumeAppCheckToken: true,
} as const;

export const SERVICE_ACCOUNTS = {
  bib: "bib-sa@toulmin-prod.iam.gserviceaccount.com",
  oafetch: "oafetch-sa@toulmin-prod.iam.gserviceaccount.com",
  oaparse: "oaparse-sa@toulmin-prod.iam.gserviceaccount.com",
  quota: "quota-sa@toulmin-prod.iam.gserviceaccount.com",
  judge: "judge-sa@toulmin-prod.iam.gserviceaccount.com",
  ops: "ops-sa@toulmin-prod.iam.gserviceaccount.com",
} as const;

export const JAKARTA_TIME_ZONE = "Asia/Jakarta" as const;
export const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/**
 * Formats an epoch timestamp (ms) into `YYYYMMDD` in the given IANA timezone (default `Asia/Jakarta`).
 */
export function yyyymmdd(epochMs: number, timeZone: string = JAKARTA_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epochMs));

  let year = "";
  let month = "";
  let day = "";
  for (const part of parts) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
  }
  if (year.length !== 4 || month.length !== 2 || day.length !== 2) {
    throw new Error(`Failed to format calendar day for timezone ${timeZone}`);
  }
  return `${year}${month}${day}`;
}

/**
 * Returns the UTC epoch milliseconds corresponding to 00:00:00.000 Asia/Jakarta on `day` (`YYYYMMDD`).
 */
export function jakartaDayStartMs(day: string): number {
  if (!/^[0-9]{8}$/.test(day)) {
    throw new Error(`Invalid YYYYMMDD day string: ${day}`);
  }
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(4, 6));
  const date = Number(day.slice(6, 8));
  if (month < 1 || month > 12 || date < 1 || date > 31) {
    throw new Error(`Out-of-range YYYYMMDD day string: ${day}`);
  }
  return Date.UTC(year, month - 1, date) - JAKARTA_OFFSET_MS;
}

/**
 * Returns the next 00:00:00.000 Asia/Jakarta reset instant (epoch ms) strictly after `epochMs`.
 */
export function nextJakartaMidnightMs(epochMs: number): number {
  const currentDay = yyyymmdd(epochMs, JAKARTA_TIME_ZONE);
  return jakartaDayStartMs(currentDay) + DAY_MS;
}

/**
 * Returns a Date `days` calendar days after the start of `day` (`YYYYMMDD`, Asia/Jakarta).
 */
export function addDays(day: string, days: number): Date {
  return new Date(jakartaDayStartMs(day) + days * DAY_MS);
}
