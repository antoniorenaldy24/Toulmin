import { HttpsError } from "firebase-functions/v2/https";
import {
  validateBibResolveRequest,
  validateBudgetMessage,
  validateOaFetchRequest,
  validateQuotaGuardRequest,
  validateRedeemJudgeCodeRequest,
  type BackendValidationResult,
  type BibResolveRequest,
  type BudgetMessage,
  type OaFetchRequest,
  type QuotaGuardRequest,
  type RedeemJudgeCodeRequest,
} from "@toulmin/schemas";

function unwrapCallable<T>(result: BackendValidationResult<T>): T {
  if (!result.ok || result.value === undefined) {
    throw new HttpsError("invalid-argument", result.errors.join("; "));
  }
  return result.value;
}

export function assertValidQuotaGuardRequest(data: unknown): QuotaGuardRequest {
  return unwrapCallable(validateQuotaGuardRequest(data));
}

export function assertValidRedeemJudgeCodeRequest(data: unknown): RedeemJudgeCodeRequest {
  return unwrapCallable(validateRedeemJudgeCodeRequest(data));
}

export function assertValidBibResolveRequest(data: unknown): BibResolveRequest {
  return unwrapCallable(validateBibResolveRequest(data));
}

export function assertValidOaFetchRequest(data: unknown): OaFetchRequest {
  return unwrapCallable(validateOaFetchRequest(data));
}

export function assertValidBudgetMessage(data: unknown): BudgetMessage {
  const result = validateBudgetMessage(data);
  if (!result.ok || result.value === undefined) {
    throw new Error(`Invalid BudgetMessage payload: ${result.errors.join("; ")}`);
  }
  return result.value;
}
