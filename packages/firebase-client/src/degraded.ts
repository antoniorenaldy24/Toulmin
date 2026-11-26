/**
 * Degraded boot state controller (`04` §5.1.1, `06` §2.3.2).
 */

import { EN_COPY } from "@toulmin/copy";

export type DegradedListener = (message: string | null) => void;

export interface DegradedStateController {
  set(message?: string): void;
  clear(): void;
  isDegraded(): boolean;
  getMessage(): string | null;
  subscribe(listener: DegradedListener): () => void;
}

export function createDegradedState(): DegradedStateController {
  let currentMessage: string | null = null;
  const listeners = new Set<DegradedListener>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener(currentMessage);
    }
  };

  return {
    set(message: string = EN_COPY.quota.degradedChip): void {
      if (currentMessage === message) {
        return;
      }
      currentMessage = message;
      notify();
    },
    clear(): void {
      if (currentMessage === null) {
        return;
      }
      currentMessage = null;
      notify();
    },
    isDegraded(): boolean {
      return currentMessage !== null;
    },
    getMessage(): string | null {
      return currentMessage;
    },
    subscribe(listener: DegradedListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const degraded: DegradedStateController = createDegradedState();
