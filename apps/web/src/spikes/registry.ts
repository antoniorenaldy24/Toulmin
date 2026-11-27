/**
 * Central Phase 0 spike registry and suite orchestrator (`07` §1.1–§1.5).
 */

import { BACKEND_SPIKES } from "./runners/backendSpikes.js";
import { CLOUD_L2_SPIKES } from "./runners/cloudSpikes.js";
import { WEB_L1_SPIKES } from "./runners/l1Spikes.js";
import { WEB_PLATFORM_SPIKES } from "./runners/platformSpikes.js";
import type {
  Phase0SpikeId,
  SpikeCategory,
  SpikeDefinition,
  SpikeRunOptions,
  SpikeRunRecord,
  SpikeRuntimeContext,
} from "./types.js";

export const SPIKE_REGISTRY: readonly SpikeDefinition[] = [
  ...WEB_L1_SPIKES,
  ...WEB_PLATFORM_SPIKES,
  ...CLOUD_L2_SPIKES,
  ...BACKEND_SPIKES,
];

const SPIKE_MAP = new Map<Phase0SpikeId, SpikeDefinition>(
  SPIKE_REGISTRY.map((def) => [def.spikeId, def])
);

export function getSpikeDefinition(id: Phase0SpikeId): SpikeDefinition {
  const found = SPIKE_MAP.get(id);
  if (!found) {
    throw new Error(`Unknown Phase 0 spike ID: ${id}`);
  }
  return found;
}

export function listSpikesByCategory(category: SpikeCategory): readonly SpikeDefinition[] {
  return SPIKE_REGISTRY.filter((s) => s.category === category);
}

export async function runSpike(
  id: Phase0SpikeId,
  ctx: SpikeRuntimeContext,
  options?: SpikeRunOptions
): Promise<SpikeRunRecord> {
  const def = getSpikeDefinition(id);
  return def.run(ctx, options);
}

export async function runSpikeSuite(
  ids: readonly Phase0SpikeId[],
  ctx: SpikeRuntimeContext,
  options?: SpikeRunOptions
): Promise<SpikeRunRecord[]> {
  const records: SpikeRunRecord[] = [];
  for (const id of ids) {
    records.push(await runSpike(id, ctx, options));
  }
  return records;
}
