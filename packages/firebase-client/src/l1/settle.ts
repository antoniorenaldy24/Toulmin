/**
 * On-device slot release & settle ceiling (`04` §1.3, §5.1.7, D-28).
 */

export type SlotReleaseMode = "ON_SETTLE" | "IMMEDIATE";
export type SlotStatus = "FREE" | "LOST";

export interface WaitForSlotReleaseParams {
  readonly earlyStop: boolean;
  readonly mode: SlotReleaseMode;
  readonly settled: Promise<void>;
  readonly ceilingMs: number;
}

export function waitForSlotRelease(params: WaitForSlotReleaseParams): Promise<SlotStatus> {
  if (!params.earlyStop || params.mode === "IMMEDIATE") {
    return Promise.resolve("FREE");
  }

  let ceiling: ReturnType<typeof setTimeout> | undefined;
  const ceilingPromise = new Promise<SlotStatus>((resolve) => {
    ceiling = setTimeout(() => {
      resolve("LOST");
    }, params.ceilingMs);
  });

  return Promise.race([
    params.settled.then((): SlotStatus => "FREE"),
    ceilingPromise,
  ]).finally(() => {
    if (ceiling !== undefined) {
      clearTimeout(ceiling);
    }
  });
}
