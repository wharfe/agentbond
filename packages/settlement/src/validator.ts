import type { AgentIdentity, SettlementTrigger } from "@agentbond/core";

export interface ValidationError {
  ok: false;
  error: {
    code: "INVALID_INPUT";
    message: string;
    retryable: false;
  };
}

export interface CreateSettlementInput {
  id?: string;
  from: AgentIdentity;
  to: AgentIdentity;
  amount: string;
  currency: string;
  trigger: SettlementTrigger;
  contractId?: string;
  authorizationTokenRef?: string;
  metadata?: Record<string, unknown>;
}

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const VALID_TRIGGERS = new Set<SettlementTrigger>([
  "manual",
  "contract_completed",
  "budget_depleted",
]);

export function validateCreateSettlementInput(
  input: CreateSettlementInput,
): ValidationError | null {
  // from validation
  if (!input.from?.id || typeof input.from.id !== "string") {
    return makeError("from.id is required");
  }

  // to validation
  if (!input.to?.id || typeof input.to.id !== "string") {
    return makeError("to.id is required");
  }

  // self-payment not allowed
  if (input.from.id === input.to.id) {
    return makeError("from and to must be different agents");
  }

  // amount validation
  if (
    !input.amount ||
    typeof input.amount !== "string" ||
    !POSITIVE_INTEGER_PATTERN.test(input.amount)
  ) {
    return makeError("amount must be a positive integer string");
  }

  // currency validation (MVP: credits only)
  if (input.currency !== "credits") {
    return makeError("currency must be 'credits'");
  }

  // trigger validation
  if (!VALID_TRIGGERS.has(input.trigger)) {
    return makeError(
      "trigger must be one of: manual, contract_completed, budget_depleted",
    );
  }

  // contractId validation (optional, but non-empty if provided)
  if (
    input.contractId !== undefined &&
    (typeof input.contractId !== "string" || input.contractId === "")
  ) {
    return makeError("contractId must be a non-empty string if provided");
  }

  return null;
}

function makeError(message: string): ValidationError {
  return {
    ok: false,
    error: {
      code: "INVALID_INPUT",
      message,
      retryable: false,
    },
  };
}
