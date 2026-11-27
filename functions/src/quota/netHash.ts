import { createHash } from "node:crypto";

/**
 * Computes the keyed network hash (`05` §3.4, `00` §3.4.6):
 * `netHash = sha256hex(day + "|" + prefix + "|" + NET_HASH_PEPPER)`.
 */
export function computeNetHash(day: string, prefix: string, pepper: string): string {
  return createHash("sha256")
    .update(`${day}|${prefix}|${pepper}`, "utf8")
    .digest("hex");
}
