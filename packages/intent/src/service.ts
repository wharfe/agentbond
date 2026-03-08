import type {
  IntentDecision,
  IntentPolicy,
  IntentRecord,
  IntentStore,
  AuditRecordStore,
  IsoDatetime,
} from "@agentbond/core";
import { evaluateIntent } from "./evaluator.js";
import { createIntentRecord, getIntentRecord, getIntentByActionId } from "./recorder.js";
import { InMemoryIntentStore } from "./store.js";
import {
  validateIntentRecordInput,
  type RecordIntentInput,
  type ValidationError,
} from "./validator.js";

export interface IntentServiceOptions {
  intentStore?: IntentStore;
  auditStore?: AuditRecordStore;
}

export interface EvaluateAndRecordRequest {
  actionId: string;
  tokenId: string;
  intentPolicy: IntentPolicy;
  intentId?: string;
}

/**
 * Orchestration layer that ties evaluator + recorder + store + audit together.
 * Handles side effects and provides the public API.
 */
export class IntentService {
  private readonly intentStore: IntentStore;
  private readonly auditStore: AuditRecordStore | undefined;

  constructor(options?: IntentServiceOptions) {
    this.intentStore = options?.intentStore ?? new InMemoryIntentStore();
    this.auditStore = options?.auditStore;
  }

  /**
   * Record an intent for an action.
   * Validates input and persists the IntentRecord.
   */
  async recordIntent(
    input: RecordIntentInput,
  ): Promise<IntentRecord | ValidationError> {
    const validationError = validateIntentRecordInput(input);
    if (validationError) {
      return validationError;
    }

    return createIntentRecord({ intentStore: this.intentStore }, input);
  }

  /**
   * Evaluate intent policy for an action and record audit trail.
   * Returns IntentDecision.
   */
  async evaluateAndRecord(
    req: EvaluateAndRecordRequest,
  ): Promise<IntentDecision> {
    const now = new Date().toISOString() as IsoDatetime;

    const decision = await evaluateIntent(
      { intentStore: this.intentStore },
      {
        actionId: req.actionId,
        tokenId: req.tokenId,
        intentPolicy: req.intentPolicy,
        intentId: req.intentId,
        now,
      },
    );

    // Record audit trail if auditStore is provided
    if (this.auditStore) {
      const shouldAttachIntentRef =
        req.intentPolicy.auditLevel !== "none" && decision.intentId;

      await this.auditStore.append({
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        actionId: req.actionId,
        authorizationTokenId: req.tokenId,
        intentRef: shouldAttachIntentRef ? decision.intentId : undefined,
        layer: "intent",
        outcome: decision.allowed ? "allowed" : "denied",
        reason: decision.reasonCode,
        timestamp: now,
      });
    }

    return decision;
  }

  /**
   * Get an IntentRecord by ID.
   */
  async getIntent(id: string): Promise<IntentRecord | null> {
    return getIntentRecord({ intentStore: this.intentStore }, id);
  }

  /**
   * Get an IntentRecord by action ID.
   */
  async getIntentByActionId(actionId: string): Promise<IntentRecord | null> {
    return getIntentByActionId({ intentStore: this.intentStore }, actionId);
  }
}
