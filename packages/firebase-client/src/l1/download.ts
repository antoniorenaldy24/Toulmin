/**
 * User-gesture-initiated on-device model download (`04` §5.1.3).
 */

import { getDefaultRuntime, type FirebaseRuntime } from "../firebase.js";
import { localModel } from "./models.js";

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export async function startModelDownload(
  onProgress: (fraction: number) => void,
  runtime: FirebaseRuntime = getDefaultRuntime()
): Promise<void> {
  const model = localModel("TriageV1", "ONLY_ON_DEVICE", runtime);
  await model.initializeDeviceModel((progressValue: number) => {
    onProgress(clampProgress(progressValue));
  });
}
