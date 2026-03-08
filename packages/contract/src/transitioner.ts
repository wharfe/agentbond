import type {
  Contract,
  ContractDecision,
  ContractStatus,
  IsoDatetime,
} from "@agentbond/core";
import { makeDecision } from "./evaluator.js";

// Valid status transitions: { from → Set<to> }
const VALID_TRANSITIONS: Record<ContractStatus, Set<ContractStatus>> = {
  draft: new Set(["active"]),
  active: new Set(["completed", "disputed"]),
  completed: new Set(), // terminal state
  disputed: new Set(["active", "completed"]),
};

/**
 * Validate whether a status transition is allowed.
 * Pure function — no side effects.
 */
export function validateTransition(
  contract: Contract,
  to: ContractStatus,
  byAgentId: string,
  now: IsoDatetime,
): ContractDecision {
  // Only principal can transition
  const principal = contract.parties.find((p) => p.role === "principal");
  if (!principal || principal.agent.id !== byAgentId) {
    return makeDecision("UNAUTHORIZED_TRANSITION", now, contract.id);
  }

  // Check transition is valid
  const allowed = VALID_TRANSITIONS[contract.status];
  if (!allowed.has(to)) {
    return makeDecision("TRANSITION_NOT_ALLOWED", now, contract.id);
  }

  return makeDecision("ALLOWED", now, contract.id);
}
