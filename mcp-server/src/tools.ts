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
  limit: z.string().regex(/^[1-9]\d*$/, "Budget limit must be a positive integer string"),
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
  expiry: z.string().regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    "Expiry must be a valid RFC 3339 datetime string",
  ),
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

// Intent schemas

const IntentEvidenceSchema = z.object({
  type: z.enum(["human-instruction", "model-summary", "system-rule"]),
  content: z.string().max(1000, "Evidence content must be 1000 characters or less"),
});

const IntentPolicySchema = z.object({
  requireReasoning: z.boolean(),
  auditLevel: z.enum(["none", "summary", "full"]),
});

export const RecordIntentSchema = z.object({
  id: z.string().optional(),
  actionId: z.string(),
  tokenId: z.string(),
  evidence: z.array(IntentEvidenceSchema).min(1),
  triggeredBy: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  createdAt: z.string().regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    "createdAt must be a valid RFC 3339 datetime string",
  ),
});

export const EvaluateIntentPolicySchema = z.object({
  actionId: z.string(),
  tokenId: z.string(),
  intentPolicy: IntentPolicySchema,
  intentId: z.string().optional(),
});

export const GetIntentSchema = z.object({
  intentId: z.string(),
});

export const GetIntentByActionSchema = z.object({
  actionId: z.string(),
});

// Contract schemas

const ContractPartySchema = z.object({
  agent: AgentIdentitySchema,
  role: z.enum(["principal", "executor", "approver", "payer", "payee"]),
});

const DeliverableSpecSchema = z.object({
  description: z.string().max(1000, "Description must be 1000 characters or less"),
  schema: z.record(z.unknown()).optional(),
  acceptanceCriteria: z.array(z.string()),
});

const ContractConditionSchema = z.object({
  type: z.enum(["budget_cap", "time_limit", "approval_gate", "custom"]),
  value: z.unknown().transform((v) => v as unknown),
});

export const CreateContractSchema = z.object({
  id: z.string().optional(),
  parties: z.array(ContractPartySchema).length(2),
  deliverable: DeliverableSpecSchema,
  conditions: z.array(ContractConditionSchema),
  authorizationTokenRef: z.string().min(1).optional(),
});

export const TransitionContractSchema = z.object({
  contractId: z.string(),
  to: z.enum(["active", "completed", "disputed"]),
  by: z.object({ id: z.string() }),
  reason: z.string().max(500).optional(),
});

export const EvaluateContractSchema = z.object({
  contractId: z.string(),
});

export const GetContractSchema = z.object({
  contractId: z.string(),
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
  {
    name: "agentbond_record_intent",
    description:
      "Record an intent for an action — why the agent is performing this action. Evidence must be a summary (no raw logs). Required before action evaluation when the token has requireReasoning: true.",
    inputSchema: RecordIntentSchema,
  },
  {
    name: "agentbond_evaluate_intent_policy",
    description:
      "Evaluate intent policy for an action. Checks if an IntentRecord exists when requireReasoning is true. Records the result in the audit log with intentRef linkage based on auditLevel.",
    inputSchema: EvaluateIntentPolicySchema,
  },
  {
    name: "agentbond_get_intent",
    description: "Retrieve an intent record by ID.",
    inputSchema: GetIntentSchema,
  },
  {
    name: "agentbond_get_intent_by_action",
    description: "Retrieve an intent record by action ID.",
    inputSchema: GetIntentByActionSchema,
  },
  // Contract tools

  {
    name: "agentbond_create_contract",
    description:
      "Create a new inter-agent contract in draft status. Requires exactly 2 parties (one principal, one executor). Conditions can include budget_cap, time_limit, approval_gate, or custom.",
    inputSchema: CreateContractSchema,
  },
  {
    name: "agentbond_transition_contract",
    description:
      "Transition a contract's status. Only the principal can transition. Valid transitions: draft→active, active→completed, active→disputed, disputed→active, disputed→completed.",
    inputSchema: TransitionContractSchema,
  },
  {
    name: "agentbond_evaluate_contract",
    description:
      "Evaluate whether a contract is valid for operations. Checks that the contract is active and all conditions (time_limit, budget_cap) are met.",
    inputSchema: EvaluateContractSchema,
  },
  {
    name: "agentbond_get_contract",
    description: "Retrieve a contract by ID.",
    inputSchema: GetContractSchema,
  },
] as const;
