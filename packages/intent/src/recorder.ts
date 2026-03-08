import type { IntentRecord, IntentStore } from "@agentbond/core";
import type { RecordIntentInput } from "./validator.js";

export interface RecorderDeps {
  intentStore: IntentStore;
}

/**
 * Create and persist an IntentRecord.
 * Assumes input has already been validated.
 */
export async function createIntentRecord(
  deps: RecorderDeps,
  input: RecordIntentInput,
): Promise<IntentRecord> {
  const record: IntentRecord = {
    id:
      input.id ??
      `intent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    actionId: input.actionId,
    tokenId: input.tokenId,
    evidence: input.evidence,
    triggeredBy: input.triggeredBy,
    confidence: input.confidence,
    createdAt: input.createdAt,
  };

  await deps.intentStore.save(record);
  return record;
}

/**
 * Get an IntentRecord by ID.
 */
export async function getIntentRecord(
  deps: RecorderDeps,
  id: string,
): Promise<IntentRecord | null> {
  return deps.intentStore.findById(id);
}

/**
 * Get an IntentRecord by action ID.
 */
export async function getIntentByActionId(
  deps: RecorderDeps,
  actionId: string,
): Promise<IntentRecord | null> {
  return deps.intentStore.findByActionId(actionId);
}
