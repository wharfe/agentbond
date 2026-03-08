import type { ActionScope } from "@agentbond/core";

// RFC 3339 pattern (simplified but sufficient for validation)
const RFC3339_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// Positive integer string (no leading zeros except "0" itself, which is invalid as amount)
const POSITIVE_INT_RE = /^[1-9]\d*$/;

export interface ValidationError {
  ok: false;
  error: {
    code: "INVALID_INPUT";
    message: string;
    retryable: false;
  };
}

export interface EvaluateActionInput {
  tokenId: string;
  action: {
    id: string;
    actor: { id: string };
    scope: ActionScope;
    timestamp: string;
  };
  amount: string;
}

export function validateEvaluateActionInput(
  input: Partial<EvaluateActionInput>,
): ValidationError | null {
  if (!input.tokenId) {
    return invalidInput("Missing required field: tokenId");
  }
  if (!input.action?.id) {
    return invalidInput("Missing required field: action.id");
  }
  if (!input.action?.actor?.id) {
    return invalidInput("Missing required field: action.actor.id");
  }
  if (!input.action?.scope?.domain) {
    return invalidInput("Missing required field: action.scope.domain");
  }
  if (
    !input.action?.scope?.operations ||
    input.action.scope.operations.length === 0
  ) {
    return invalidInput("Missing required field: action.scope.operations");
  }
  if (!RFC3339_RE.test(input.action.timestamp)) {
    return invalidInput("Invalid timestamp format: must be RFC 3339");
  }
  if (!input.amount || !POSITIVE_INT_RE.test(input.amount)) {
    return invalidInput(
      "Invalid amount: must be a positive integer string",
    );
  }
  return null;
}

export function validateIsoDatetime(value: string): boolean {
  return RFC3339_RE.test(value);
}

export function validatePositiveIntegerString(value: string): boolean {
  return POSITIVE_INT_RE.test(value);
}

function invalidInput(message: string): ValidationError {
  return {
    ok: false,
    error: {
      code: "INVALID_INPUT",
      message,
      retryable: false,
    },
  };
}
