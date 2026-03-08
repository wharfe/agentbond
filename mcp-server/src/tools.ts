import { z } from "zod";

// Shared schemas for tool inputs

const AgentIdentitySchema = z.object({
  id: z.string(),
  type: z.enum(["human", "ai", "service"]),
  publicKey: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const ActionScopeSchema = z.object({
  domain: z.string(),
  operations: z.array(z.string()).min(1),
  resources: z.array(z.string()).optional(),
});

const BudgetSchema = z.object({
  limit: z.string(),
  currency: z.literal("credits"),
  resetPolicy: z.enum(["per-task", "per-session", "never"]).optional(),
});

export const IssueTokenSchema = z.object({
  id: z.string(),
  parentTokenId: z.string().optional(),
  issuedBy: AgentIdentitySchema,
  issuedTo: AgentIdentitySchema,
  scopes: z.array(ActionScopeSchema).min(1),
  budget: BudgetSchema,
  expiry: z.string(),
  status: z.enum(["active", "suspended", "revoked"]).default("active"),
});

export const EvaluateActionSchema = z.object({
  tokenId: z.string(),
  action: z.object({
    id: z.string(),
    actor: AgentIdentitySchema,
    scope: ActionScopeSchema,
    timestamp: z.string(),
    authorizationRef: z.string().optional(),
    intentRef: z.string().optional(),
    contractRef: z.string().optional(),
    settlementRef: z.string().optional(),
  }),
  amount: z.string(),
});

export const RevokeTokenSchema = z.object({
  tokenId: z.string(),
});

export const SuspendTokenSchema = z.object({
  tokenId: z.string(),
});

export const ReactivateTokenSchema = z.object({
  tokenId: z.string(),
});

export const GetTokenSchema = z.object({
  tokenId: z.string(),
});

export const GetAuditLogSchema = z.object({
  layer: z
    .enum(["authorization", "intent", "contract", "settlement"])
    .optional(),
  outcome: z.enum(["allowed", "denied", "pending"]).optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

export const GetAuditByActionIdSchema = z.object({
  actionId: z.string(),
});

export const GetAuditByTokenIdSchema = z.object({
  tokenId: z.string(),
});

export const TOOL_DEFINITIONS = [
  {
    name: "agentbond_issue_token",
    description:
      "Issue a new authorization token. If parentTokenId is provided, delegation constraints are validated (child scope/budget/expiry must not exceed parent).",
    inputSchema: IssueTokenSchema,
  },
  {
    name: "agentbond_evaluate_action",
    description:
      "Evaluate an action against an authorization token and consume budget if allowed. Returns an AuthorizationDecision with allowed/denied status, reason code, and retryable flag.",
    inputSchema: EvaluateActionSchema,
  },
  {
    name: "agentbond_revoke_token",
    description:
      "Permanently revoke an authorization token. All child tokens will be denied via cascade evaluation (their status is not changed).",
    inputSchema: RevokeTokenSchema,
  },
  {
    name: "agentbond_suspend_token",
    description:
      "Temporarily suspend an authorization token. Can be reactivated later. Child tokens are denied while parent is suspended.",
    inputSchema: SuspendTokenSchema,
  },
  {
    name: "agentbond_reactivate_token",
    description:
      "Reactivate a suspended authorization token. Child tokens automatically become usable again.",
    inputSchema: ReactivateTokenSchema,
  },
  {
    name: "agentbond_get_token",
    description: "Retrieve an authorization token by ID.",
    inputSchema: GetTokenSchema,
  },
  {
    name: "agentbond_get_audit_log",
    description:
      "Query the audit log with optional filters (layer, outcome, time range, limit).",
    inputSchema: GetAuditLogSchema,
  },
  {
    name: "agentbond_get_audit_by_action",
    description: "Get audit records for a specific action ID.",
    inputSchema: GetAuditByActionIdSchema,
  },
  {
    name: "agentbond_get_audit_by_token",
    description: "Get audit records for a specific token ID.",
    inputSchema: GetAuditByTokenIdSchema,
  },
] as const;
