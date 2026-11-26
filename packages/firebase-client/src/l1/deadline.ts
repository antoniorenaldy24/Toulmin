/**
 * L1 call deadline race helper (`04` §1.3, §5.1.7, D-28).
 *
 * Guarantees `clearTimeout` runs on every completion path so no timer outlives the call.
 */

export async function raceWithDeadline<T>(
  work: Promise<T>,
  deadlineMs: number,
  onDeadline: () => T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(onDeadline());
    }, deadlineMs);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
