import { onRequest, type HttpsOptions, type Request } from "firebase-functions/v2/https";
import { executeParseBuffer, extractParseInputFromHttpRequest } from "./handler.js";

// Note: Literal constants here keep functions/src/oaparse/** 100% isolated from common/* (`firebase-admin`).
const PARSER: HttpsOptions = {
  region: "us-central1",
  invoker: ["oafetch-sa@toulmin-prod.iam.gserviceaccount.com"],
  serviceAccount: "oaparse-sa@toulmin-prod.iam.gserviceaccount.com",
  memory: "2GiB",
  cpu: 1,
  concurrency: 1,
  timeoutSeconds: 60,
};

interface HttpJsonResponse {
  status(code: number): { json(body: unknown): unknown };
}

async function handleParse(request: Request, response: HttpJsonResponse): Promise<void> {
  const input = extractParseInputFromHttpRequest({
    method: request.method,
    headers: request.headers as Record<string, string | string[] | undefined>,
    rawBody: request.rawBody,
    body: request.body,
  });
  if (!input.ok) {
    response.status(input.status).json({ error: input.error });
    return;
  }
  const result = await executeParseBuffer(input.bytes, input.refId);
  response.status(result.status).json(result.body);
}

export const oaParse = onRequest({ ...PARSER, maxInstances: 10 }, handleParse);
export const oaParseJudge = onRequest({ ...PARSER, maxInstances: 4 }, handleParse);
