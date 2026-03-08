import type {
  AuthorizationDecision,
  AuthorizationReasonCode,
  AuthorizationToken,
  ActionScope,
  IsoDatetime,
} from "@agentbond/core";
import { matchesScope } from "./scope.js";
import type { TokenStore } from "./token-store.js";

// Standard messages from authorization.spec.md Section 5.3
const MESSAGES: Record<AuthorizationReasonCode, string> = {
  ALLOWED: "Authorization granted",
  TOKEN_NOT_FOUND: "Authorization token not found",
  TOKEN_EXPIRED: "Authorization token has expired",
  TOKEN_REVOKED: "Authorization token has been revoked",
  TOKEN_SUSPENDED: "Authorization token is suspended",
  SCOPE_MISMATCH: "Requested action is outside authorized scope",
  BUDGET_EXCEEDED: "Insufficient budget for this action",
  PARENT_TOKEN_INACTIVE: "Parent token in chain is inactive",
  PARENT_SCOPE_EXCEEDED: "Requested scope exceeds parent token scope",
  PARENT_BUDGET_EXCEEDED: "Requested budget exceeds parent token budget",
};

// retryable flags from authorization.spec.md Section 5.4
const RETRYABLE: Record<AuthorizationReasonCode, boolean> = {
  ALLOWED: false,
  TOKEN_NOT_FOUND: false,
  TOKEN_EXPIRED: false,
  TOKEN_REVOKED: false,
  TOKEN_SUSPENDED: true,
  SCOPE_MISMATCH: false,
  BUDGET_EXCEEDED: true,
  PARENT_TOKEN_INACTIVE: true,
  PARENT_SCOPE_EXCEEDED: false,
  PARENT_BUDGET_EXCEEDED: false,
};

export interface EvaluationContext {
  tokenStore: TokenStore;
  getSpent: (tokenId: string) => Promise<string>;
}

export interface EvaluateRequest {
  tokenId: string;
  actionScope: ActionScope;
  amount: string;
  now: IsoDatetime;
}

/**
 * Pure authorization evaluation logic.
 * Does not perform side effects (no ledger writes, no audit writes).
 * Follows evaluation order from authorization.spec.md Section 4.
 */
export async function evaluate(
  ctx: EvaluationContext,
  req: EvaluateRequest,
): Promise<AuthorizationDecision> {
  const now = req.now;

  // Step 1: Token existence
  const token = ctx.tokenStore.get(req.tokenId);
  if (!token) {
    return makeDecision("TOKEN_NOT_FOUND", now);
  }

  // Step 2: Token status
  if (token.status === "revoked") {
    return makeDecision("TOKEN_REVOKED", now, token.id);
  }
  if (token.status === "suspended") {
    return makeDecision("TOKEN_SUSPENDED", now, token.id);
  }

  // Step 3: Token expiry
  if (new Date(token.expiry).getTime() <= new Date(now).getTime()) {
    return makeDecision("TOKEN_EXPIRED", now, token.id);
  }

  // Step 4: Parent chain evaluation (Section 3)
  const parentResult = evaluateParentChain(ctx.tokenStore, token, now);
  if (parentResult) {
    return parentResult;
  }

  // Step 5: Scope matching (Section 1)
  if (!matchesScope(token.scopes, req.actionScope)) {
    return makeDecision("SCOPE_MISMATCH", now, token.id);
  }

  // Step 6: Budget check
  const spent = BigInt(await ctx.getSpent(token.id));
  const limit = BigInt(token.budget.limit);
  const amount = BigInt(req.amount);
  if (limit - spent < amount) {
    return makeDecision("BUDGET_EXCEEDED", now, token.id);
  }

  // Step 7: Parent scope consistency (delegation constraint)
  if (token.parentTokenId) {
    const parentScopeResult = evaluateParentScopeConstraint(
      ctx.tokenStore,
      token,
      req.actionScope,
      now,
    );
    if (parentScopeResult) {
      return parentScopeResult;
    }
  }

  // Step 8: Parent budget consistency
  if (token.parentTokenId) {
    const parentBudgetResult = await evaluateParentBudgetConstraint(
      ctx,
      token,
      now,
    );
    if (parentBudgetResult) {
      return parentBudgetResult;
    }
  }

  // All checks passed
  return makeDecision("ALLOWED", now, token.id);
}

function evaluateParentChain(
  tokenStore: TokenStore,
  token: AuthorizationToken,
  now: IsoDatetime,
): AuthorizationDecision | null {
  let currentTokenId = token.parentTokenId;
  while (currentTokenId) {
    const parent = tokenStore.get(currentTokenId);
    if (!parent) {
      return makeDecision("PARENT_TOKEN_INACTIVE", now, token.id);
    }
    if (parent.status !== "active") {
      return makeDecision("PARENT_TOKEN_INACTIVE", now, token.id);
    }
    if (new Date(parent.expiry).getTime() <= new Date(now).getTime()) {
      return makeDecision("PARENT_TOKEN_INACTIVE", now, token.id);
    }
    currentTokenId = parent.parentTokenId;
  }
  return null;
}

function evaluateParentScopeConstraint(
  tokenStore: TokenStore,
  token: AuthorizationToken,
  actionScope: ActionScope,
  now: IsoDatetime,
): AuthorizationDecision | null {
  let currentTokenId = token.parentTokenId;
  while (currentTokenId) {
    const parent = tokenStore.get(currentTokenId);
    if (!parent) {
      break;
    }
    if (!matchesScope(parent.scopes, actionScope)) {
      return makeDecision("PARENT_SCOPE_EXCEEDED", now, token.id);
    }
    currentTokenId = parent.parentTokenId;
  }
  return null;
}

async function evaluateParentBudgetConstraint(
  ctx: EvaluationContext,
  token: AuthorizationToken,
  now: IsoDatetime,
): Promise<AuthorizationDecision | null> {
  // Check if the child's remaining balance exceeds the parent's remaining balance
  const childSpent = BigInt(await ctx.getSpent(token.id));
  const childRemaining = BigInt(token.budget.limit) - childSpent;

  let currentTokenId = token.parentTokenId;
  while (currentTokenId) {
    const parent = ctx.tokenStore.get(currentTokenId);
    if (!parent) {
      break;
    }
    const parentSpent = BigInt(await ctx.getSpent(parent.id));
    const parentRemaining = BigInt(parent.budget.limit) - parentSpent;
    if (childRemaining > parentRemaining) {
      return makeDecision("PARENT_BUDGET_EXCEEDED", now, token.id);
    }
    currentTokenId = parent.parentTokenId;
  }
  return null;
}

function makeDecision(
  reasonCode: AuthorizationReasonCode,
  evaluatedAt: IsoDatetime,
  tokenId?: string,
): AuthorizationDecision {
  return {
    allowed: reasonCode === "ALLOWED",
    reasonCode,
    message: MESSAGES[reasonCode],
    retryable: RETRYABLE[reasonCode],
    evaluatedAt,
    tokenId,
  };
}
