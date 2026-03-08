import type { ContractParty, ContractCondition } from "@agentbond/core";

export interface ValidationError {
  ok: false;
  error: {
    code: "INVALID_INPUT";
    message: string;
    retryable: false;
  };
}

export interface CreateContractInput {
  id?: string;
  parties: ContractParty[];
  deliverable: {
    description: string;
    schema?: Record<string, unknown>;
    acceptanceCriteria: string[];
  };
  conditions: ContractCondition[];
  authorizationTokenRef?: string;
}

export interface TransitionInput {
  contractId: string;
  to: string;
  by: { id: string };
  reason?: string;
}

const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_REASON_LENGTH = 500;
const VALID_CONDITION_TYPES = new Set([
  "budget_cap",
  "time_limit",
  "approval_gate",
  "custom",
]);
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isRfc3339(value: string): boolean {
  return RFC3339_PATTERN.test(value) && !isNaN(Date.parse(value));
}

export function validateCreateContractInput(
  input: CreateContractInput,
): ValidationError | null {
  // parties validation
  if (!Array.isArray(input.parties) || input.parties.length !== 2) {
    return makeError("parties must contain exactly 2 entries");
  }

  const roles = input.parties.map((p) => p.role);
  if (!roles.includes("principal") || !roles.includes("executor")) {
    return makeError("parties must contain exactly one principal and one executor");
  }

  if (roles[0] === roles[1]) {
    return makeError("parties must contain exactly one principal and one executor");
  }

  for (let i = 0; i < input.parties.length; i++) {
    const party = input.parties[i];
    if (!party.agent?.id || typeof party.agent.id !== "string") {
      return makeError(`parties[${i}].agent.id is required`);
    }
  }

  // principal and executor must be different agents
  const principalId = input.parties.find((p) => p.role === "principal")!.agent.id;
  const executorId = input.parties.find((p) => p.role === "executor")!.agent.id;
  if (principalId === executorId) {
    return makeError("principal and executor must be different agents");
  }

  // deliverable validation
  if (!input.deliverable || typeof input.deliverable !== "object") {
    return makeError("deliverable is required");
  }

  if (
    !input.deliverable.description ||
    typeof input.deliverable.description !== "string"
  ) {
    return makeError("deliverable.description is required");
  }

  if (input.deliverable.description.length > MAX_DESCRIPTION_LENGTH) {
    return makeError(
      `deliverable.description exceeds maximum length of ${MAX_DESCRIPTION_LENGTH} characters`,
    );
  }

  if (!Array.isArray(input.deliverable.acceptanceCriteria)) {
    return makeError("deliverable.acceptanceCriteria must be an array");
  }

  // conditions validation
  if (!Array.isArray(input.conditions)) {
    return makeError("conditions must be an array");
  }

  for (let i = 0; i < input.conditions.length; i++) {
    const cond = input.conditions[i];
    if (!VALID_CONDITION_TYPES.has(cond.type)) {
      return makeError(
        `conditions[${i}].type must be one of: budget_cap, time_limit, approval_gate, custom`,
      );
    }

    if (cond.type === "budget_cap") {
      const value = cond.value as { limit?: string; currency?: string } | undefined;
      if (!value || typeof value !== "object") {
        return makeError(`conditions[${i}].value is required for budget_cap`);
      }
      if (
        !value.limit ||
        typeof value.limit !== "string" ||
        !POSITIVE_INTEGER_PATTERN.test(value.limit)
      ) {
        return makeError(
          `conditions[${i}].value.limit must be a positive integer string`,
        );
      }
      if (value.currency !== "credits") {
        return makeError(
          `conditions[${i}].value.currency must be 'credits'`,
        );
      }
    }

    if (cond.type === "time_limit") {
      const value = cond.value as { deadline?: string } | undefined;
      if (!value || typeof value !== "object") {
        return makeError(`conditions[${i}].value is required for time_limit`);
      }
      if (
        !value.deadline ||
        typeof value.deadline !== "string" ||
        !isRfc3339(value.deadline)
      ) {
        return makeError(
          `conditions[${i}].value.deadline must be a valid RFC 3339 datetime`,
        );
      }
    }
  }

  // authorizationTokenRef validation
  if (
    input.authorizationTokenRef !== undefined &&
    (typeof input.authorizationTokenRef !== "string" ||
      input.authorizationTokenRef === "")
  ) {
    return makeError("authorizationTokenRef must be a non-empty string if provided");
  }

  return null;
}

export function validateTransitionInput(
  input: TransitionInput,
): ValidationError | null {
  if (!input.contractId || typeof input.contractId !== "string") {
    return makeError("Missing required field: contractId");
  }

  if (!input.to || typeof input.to !== "string") {
    return makeError("Missing required field: to");
  }

  if (!input.by?.id || typeof input.by.id !== "string") {
    return makeError("Missing required field: by.id");
  }

  if (input.reason !== undefined) {
    if (typeof input.reason !== "string") {
      return makeError("reason must be a string");
    }
    if (input.reason.length > MAX_REASON_LENGTH) {
      return makeError(
        `reason exceeds maximum length of ${MAX_REASON_LENGTH} characters`,
      );
    }
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
