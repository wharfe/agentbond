import type {
  IntentDecision,
  IntentPolicy,
  IntentReasonCode,
  IntentStore,
  IsoDatetime,
} from "@agentbond/core";

export interface IntentEvaluationContext {
  intentStore: IntentStore;
}

export interface IntentEvaluateRequest {
  actionId: string;
  tokenId: string;
  intentPolicy: IntentPolicy;
  intentId?: string; // Explicitly specified intent record ID
  now: IsoDatetime;
}

const MESSAGES: Record<IntentReasonCode, string> = {
  ALLOWED: "Intent recorded successfully",
  INTENT_REQUIRED: "Intent record is required by policy but not provided",
  INTENT_NOT_FOUND: "Specified intent record not found",
  INVALID_INPUT: "Invalid input: see error details",
};

const RETRYABLE: Record<IntentReasonCode, boolean> = {
  ALLOWED: false,
  INTENT_REQUIRED: true,
  INTENT_NOT_FOUND: false,
  INVALID_INPUT: false,
};

function makeDecision(
  reasonCode: IntentReasonCode,
  now: IsoDatetime,
  intentId?: string,
): IntentDecision {
  return {
    allowed: reasonCode === "ALLOWED",
    reasonCode,
    message: MESSAGES[reasonCode],
    retryable: RETRYABLE[reasonCode],
    evaluatedAt: now,
    intentId,
  };
}

/**
 * Pure evaluation logic for intent policy.
 * No side effects — does not write to any store.
 */
export async function evaluateIntent(
  ctx: IntentEvaluationContext,
  req: IntentEvaluateRequest,
): Promise<IntentDecision> {
  // If an explicit intentId is specified, look it up and verify it matches the action
  if (req.intentId) {
    const record = await ctx.intentStore.findById(req.intentId);
    if (!record) {
      return makeDecision("INTENT_NOT_FOUND", req.now);
    }
    // Verify the intent record belongs to the requested action and token
    if (record.actionId !== req.actionId || record.tokenId !== req.tokenId) {
      return makeDecision("INTENT_NOT_FOUND", req.now);
    }
    return makeDecision("ALLOWED", req.now, record.id);
  }

  // Look up intent record by actionId
  const record = await ctx.intentStore.findByActionId(req.actionId);

  if (req.intentPolicy.requireReasoning) {
    if (!record) {
      return makeDecision("INTENT_REQUIRED", req.now);
    }
    return makeDecision("ALLOWED", req.now, record.id);
  }

  // requireReasoning: false — always allowed, attach intentId if record exists
  return makeDecision("ALLOWED", req.now, record?.id);
}
