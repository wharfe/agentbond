import type {
  Contract,
  ContractDecision,
  ContractReasonCode,
  ContractStore,
  IsoDatetime,
} from "@agentbond/core";

export interface EvaluationContext {
  contractStore: ContractStore;
}

export interface EvaluateRequest {
  contractId: string;
  now: IsoDatetime;
}

const MESSAGES: Record<ContractReasonCode, string> = {
  ALLOWED: "Contract operation successful",
  CONTRACT_NOT_FOUND: "Contract not found",
  CONTRACT_NOT_ACTIVE: "Contract is not in active status",
  CONTRACT_DEADLINE_EXCEEDED: "Contract deadline has passed",
  CONTRACT_BUDGET_EXCEEDED: "Action exceeds contract budget cap",
  TRANSITION_NOT_ALLOWED: "Status transition is not permitted",
  UNAUTHORIZED_TRANSITION: "Only the principal can transition contract status",
  INVALID_INPUT: "Invalid input: see error details",
};

const RETRYABLE: Record<ContractReasonCode, boolean> = {
  ALLOWED: false,
  CONTRACT_NOT_FOUND: false,
  CONTRACT_NOT_ACTIVE: true,
  CONTRACT_DEADLINE_EXCEEDED: false,
  CONTRACT_BUDGET_EXCEEDED: false,
  TRANSITION_NOT_ALLOWED: false,
  UNAUTHORIZED_TRANSITION: false,
  INVALID_INPUT: false,
};

function makeDecision(
  code: ContractReasonCode,
  evaluatedAt: IsoDatetime,
  contractId?: string,
): ContractDecision {
  return {
    allowed: code === "ALLOWED",
    reasonCode: code,
    message: MESSAGES[code],
    retryable: RETRYABLE[code],
    evaluatedAt,
    contractId,
  };
}

/**
 * Evaluate whether a contract is in a valid state for operations.
 * Pure function — no side effects.
 */
export async function evaluateContract(
  ctx: EvaluationContext,
  req: EvaluateRequest,
): Promise<ContractDecision> {
  const contract = await ctx.contractStore.findById(req.contractId);
  if (!contract) {
    return makeDecision("CONTRACT_NOT_FOUND", req.now);
  }

  if (contract.status !== "active") {
    return makeDecision("CONTRACT_NOT_ACTIVE", req.now, contract.id);
  }

  // Evaluate conditions (AND logic — first violation wins)
  const conditionResult = evaluateConditions(contract, req.now);
  if (conditionResult) {
    return makeDecision(conditionResult, req.now, contract.id);
  }

  return makeDecision("ALLOWED", req.now, contract.id);
}

/**
 * Evaluate all conditions on a contract. Returns the first failing reason code, or null if all pass.
 */
function evaluateConditions(
  contract: Contract,
  now: IsoDatetime,
): ContractReasonCode | null {
  for (const cond of contract.conditions) {
    if (cond.type === "time_limit") {
      const value = cond.value as { deadline: string };
      if (now >= value.deadline) {
        return "CONTRACT_DEADLINE_EXCEEDED";
      }
    }

    if (cond.type === "budget_cap") {
      // Budget tracking is delegated to the auth layer.
      // Contract evaluator checks structural constraints only:
      // if an associated auth token's budget.limit exceeds the contract cap, deny.
      // This is evaluated externally via the service layer.
    }
  }

  return null;
}

export { makeDecision, MESSAGES, RETRYABLE };
