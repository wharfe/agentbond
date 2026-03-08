import type { IntentEvidence } from "@agentbond/core";

export interface ValidationError {
  ok: false;
  error: {
    code: "INVALID_INPUT";
    message: string;
    retryable: false;
  };
}

export interface RecordIntentInput {
  id?: string;
  actionId: string;
  tokenId: string;
  evidence: IntentEvidence[];
  triggeredBy?: string;
  confidence?: number;
  createdAt: string;
}

const VALID_EVIDENCE_TYPES = new Set([
  "human-instruction",
  "model-summary",
  "system-rule",
]);

const MAX_CONTENT_LENGTH = 1000;

// RFC 3339 pattern (simplified but sufficient)
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isRfc3339(value: string): boolean {
  return RFC3339_PATTERN.test(value) && !isNaN(Date.parse(value));
}

export function validateIntentRecordInput(
  input: RecordIntentInput,
): ValidationError | null {
  if (!input.actionId || typeof input.actionId !== "string") {
    return makeError("Missing required field: actionId");
  }

  if (!input.tokenId || typeof input.tokenId !== "string") {
    return makeError("Missing required field: tokenId");
  }

  if (!Array.isArray(input.evidence)) {
    return makeError("evidence must be an array");
  }

  if (input.evidence.length === 0) {
    return makeError("evidence must contain at least 1 entry");
  }

  for (let i = 0; i < input.evidence.length; i++) {
    const ev = input.evidence[i];

    if (!ev || typeof ev !== "object") {
      return makeError(`evidence[${i}] must be an object`);
    }

    if (!VALID_EVIDENCE_TYPES.has(ev.type)) {
      return makeError(
        `evidence[${i}].type must be one of: human-instruction, model-summary, system-rule`,
      );
    }

    if (!ev.content || typeof ev.content !== "string") {
      return makeError(`evidence[${i}].content is required`);
    }

    if (ev.content.length > MAX_CONTENT_LENGTH) {
      return makeError(
        `evidence[${i}].content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`,
      );
    }
  }

  if (input.confidence !== undefined) {
    if (
      typeof input.confidence !== "number" ||
      input.confidence < 0 ||
      input.confidence > 1
    ) {
      return makeError("confidence must be a number between 0 and 1");
    }
  }

  if (!input.createdAt || !isRfc3339(input.createdAt)) {
    return makeError("createdAt must be a valid RFC 3339 datetime string");
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
