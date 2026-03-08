import type { AuthService } from "@agentbond/auth";
import type { ValidationError } from "@agentbond/auth";
import type { AuthorizationDecision } from "@agentbond/core";
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
} from "./tools.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

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

function isValidationError(
  result: AuthorizationDecision | ValidationError,
): result is ValidationError {
  return "ok" in result && result.ok === false;
}

export async function handleToolCall(
  service: AuthService,
  name: string,
  args: unknown,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "agentbond_issue_token": {
        const input = IssueTokenSchema.parse(args);
        const token = await service.issueToken(input);
        return jsonResult(token);
      }

      case "agentbond_evaluate_action": {
        const input = EvaluateActionSchema.parse(args);
        const result = await service.evaluateAndConsume(
          input.tokenId,
          input.action,
          input.amount,
        );
        if (isValidationError(result)) {
          return jsonResult(result);
        }
        return jsonResult(result);
      }

      case "agentbond_revoke_token": {
        const input = RevokeTokenSchema.parse(args);
        service.updateTokenStatus(input.tokenId, "revoked");
        return jsonResult({ ok: true, tokenId: input.tokenId, status: "revoked" });
      }

      case "agentbond_suspend_token": {
        const input = SuspendTokenSchema.parse(args);
        service.updateTokenStatus(input.tokenId, "suspended");
        return jsonResult({ ok: true, tokenId: input.tokenId, status: "suspended" });
      }

      case "agentbond_reactivate_token": {
        const input = ReactivateTokenSchema.parse(args);
        service.updateTokenStatus(input.tokenId, "active");
        return jsonResult({ ok: true, tokenId: input.tokenId, status: "active" });
      }

      case "agentbond_get_token": {
        const input = GetTokenSchema.parse(args);
        const token = service.getToken(input.tokenId);
        if (!token) {
          return errorResult(`Token not found: ${input.tokenId}`);
        }
        return jsonResult(token);
      }

      case "agentbond_get_audit_log": {
        const input = GetAuditLogSchema.parse(args);
        const records = await service.getAuditLog(input);
        return jsonResult(records);
      }

      case "agentbond_get_audit_by_action": {
        const input = GetAuditByActionIdSchema.parse(args);
        const records = await service.getAuditByActionId(input.actionId);
        return jsonResult(records);
      }

      case "agentbond_get_audit_by_token": {
        const input = GetAuditByTokenIdSchema.parse(args);
        const records = await service.getAuditByTokenId(input.tokenId);
        return jsonResult(records);
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
