import type { AuthService } from "@agentbond/auth";
import type { ValidationError as AuthValidationError } from "@agentbond/auth";
import type { IntentService } from "@agentbond/intent";
import type { ValidationError as IntentValidationError } from "@agentbond/intent";
import type { AuthorizationDecision, IntentRecord } from "@agentbond/core";
import {
  IssueTokenSchema,
  EvaluateActionSchema,
  RevokeTokenSchema,
  SuspendTokenSchema,
  ReactivateTokenSchema,
  GetTokenSchema,
  GetAuditLogSchema,
  GetAuditByActionIdSchema,
  GetAuditByTokenIdSchema,
  RecordIntentSchema,
  EvaluateIntentPolicySchema,
  GetIntentSchema,
  GetIntentByActionSchema,
} from "./tools.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export interface ServiceDeps {
  authService: AuthService;
  intentService: IntentService;
}

function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function isAuthValidationError(
  result: AuthorizationDecision | AuthValidationError,
): result is AuthValidationError {
  return "ok" in result && result.ok === false;
}

function isIntentValidationError(
  result: IntentRecord | IntentValidationError,
): result is IntentValidationError {
  return "ok" in result && (result as IntentValidationError).ok === false;
}

export async function handleToolCall(
  deps: ServiceDeps,
  name: string,
  args: unknown,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "agentbond_issue_token": {
        const input = IssueTokenSchema.parse(args);
        const token = await deps.authService.issueToken(input);
        return jsonResult(token);
      }

      case "agentbond_evaluate_action": {
        const input = EvaluateActionSchema.parse(args);
        const result = await deps.authService.evaluateAndConsume(
          input.tokenId,
          input.action,
          input.amount,
        );
        if (isAuthValidationError(result)) {
          return jsonResult(result);
        }
        return jsonResult(result);
      }

      case "agentbond_revoke_token": {
        const input = RevokeTokenSchema.parse(args);
        deps.authService.updateTokenStatus(input.tokenId, "revoked");
        return jsonResult({ ok: true, tokenId: input.tokenId, status: "revoked" });
      }

      case "agentbond_suspend_token": {
        const input = SuspendTokenSchema.parse(args);
        deps.authService.updateTokenStatus(input.tokenId, "suspended");
        return jsonResult({ ok: true, tokenId: input.tokenId, status: "suspended" });
      }

      case "agentbond_reactivate_token": {
        const input = ReactivateTokenSchema.parse(args);
        deps.authService.updateTokenStatus(input.tokenId, "active");
        return jsonResult({ ok: true, tokenId: input.tokenId, status: "active" });
      }

      case "agentbond_get_token": {
        const input = GetTokenSchema.parse(args);
        const token = deps.authService.getToken(input.tokenId);
        if (!token) {
          return errorResult(`Token not found: ${input.tokenId}`);
        }
        return jsonResult(token);
      }

      case "agentbond_get_audit_log": {
        const input = GetAuditLogSchema.parse(args);
        const records = await deps.authService.getAuditLog(input);
        return jsonResult(records);
      }

      case "agentbond_get_audit_by_action": {
        const input = GetAuditByActionIdSchema.parse(args);
        const records = await deps.authService.getAuditByActionId(input.actionId);
        return jsonResult(records);
      }

      case "agentbond_get_audit_by_token": {
        const input = GetAuditByTokenIdSchema.parse(args);
        const records = await deps.authService.getAuditByTokenId(input.tokenId);
        return jsonResult(records);
      }

      // Intent tools

      case "agentbond_record_intent": {
        const input = RecordIntentSchema.parse(args);
        const result = await deps.intentService.recordIntent(input);
        if (isIntentValidationError(result)) {
          return jsonResult(result);
        }
        return jsonResult(result);
      }

      case "agentbond_evaluate_intent_policy": {
        const input = EvaluateIntentPolicySchema.parse(args);
        const decision = await deps.intentService.evaluateAndRecord(input);
        return jsonResult(decision);
      }

      case "agentbond_get_intent": {
        const input = GetIntentSchema.parse(args);
        const record = await deps.intentService.getIntent(input.intentId);
        if (!record) {
          return errorResult(`Intent record not found: ${input.intentId}`);
        }
        return jsonResult(record);
      }

      case "agentbond_get_intent_by_action": {
        const input = GetIntentByActionSchema.parse(args);
        const record = await deps.intentService.getIntentByActionId(input.actionId);
        if (!record) {
          return errorResult(`Intent record not found for action: ${input.actionId}`);
        }
        return jsonResult(record);
      }

      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return errorResult(message);
  }
}
