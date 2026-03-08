import type {
  AuthorizationDecision,
  AuthorizationToken,
  AgentAction,
  AuditRecord,
  AuditRecordStore,
  AuditQueryOptions,
  BudgetService,
  BudgetLedgerStore,
  IsoDatetime,
} from "@agentbond/core";
import { evaluate } from "./evaluator.js";
import { issueToken } from "./issuer.js";
import type { TokenStore } from "./token-store.js";
import { InMemoryTokenStore } from "./token-store.js";
import { InMemoryBudgetLedgerStore } from "./ledger.js";
import { InMemoryAuditRecordStore } from "./audit.js";
import {
  validateEvaluateActionInput,
  validatePositiveIntegerString,
  type ValidationError,
} from "./validator.js";

export interface AuthServiceOptions {
  tokenStore?: TokenStore;
  ledgerStore?: BudgetLedgerStore;
  auditStore?: AuditRecordStore;
}

/**
 * Orchestration layer that ties evaluator + ledger + issuer together.
 * Handles side effects and provides the public API.
 */
export class AuthService implements BudgetService {
  private readonly tokenStore: TokenStore;
  private readonly ledgerStore: BudgetLedgerStore;
  private readonly auditStore: AuditRecordStore;
  // Per-token lock to ensure atomic evaluate-then-consume
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(options?: AuthServiceOptions) {
    this.tokenStore = options?.tokenStore ?? new InMemoryTokenStore();
    this.ledgerStore = options?.ledgerStore ?? new InMemoryBudgetLedgerStore();
    this.auditStore = options?.auditStore ?? new InMemoryAuditRecordStore();
  }

  private async withLock<T>(tokenId: string, fn: () => Promise<T>): Promise<T> {
    // Wait for any pending operation on this token
    const pending = this.locks.get(tokenId) ?? Promise.resolve();
    let resolve: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    this.locks.set(tokenId, next);
    await pending;
    try {
      return await fn();
    } finally {
      resolve!();
      // Clean up lock entry if no other operation is queued
      if (this.locks.get(tokenId) === next) {
        this.locks.delete(tokenId);
      }
    }
  }

  /**
   * Issue a new authorization token.
   * Validates delegation constraints for child tokens.
   */
  async issueToken(token: AuthorizationToken): Promise<AuthorizationToken> {
    return issueToken(
      {
        tokenStore: this.tokenStore,
        getSpent: (tokenId) => this.ledgerStore.sumByTokenId(tokenId),
      },
      { token },
    );
  }

  /**
   * Evaluate an action and consume budget atomically if allowed.
   * Returns ValidationError on input validation failure,
   * or AuthorizationDecision for authorization evaluation.
   */
  async evaluateAndConsume(
    tokenId: string,
    action: AgentAction,
    amount: string,
  ): Promise<AuthorizationDecision | ValidationError> {
    // Step 0: Input validation (before lock, no side effects)
    const validationError = validateEvaluateActionInput({
      tokenId,
      action,
      amount,
    });
    if (validationError) {
      return validationError;
    }

    return this.withLock(tokenId, async () => {
      // Use server-side timestamp to prevent expiry bypass via caller-controlled time
      const now = new Date().toISOString() as IsoDatetime;

      const decision = await evaluate(
        {
          tokenStore: this.tokenStore,
          getSpent: (tid) => this.ledgerStore.sumByTokenId(tid),
        },
        {
          tokenId,
          actionScope: action.scope,
          amount,
          now,
        },
      );

      // Only consume budget if allowed
      if (decision.allowed) {
        await this.ledgerStore.append({
          id: `ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          tokenId,
          amount,
          actionId: action.id,
          timestamp: now,
        });
      }

      // Record audit trail
      await this.auditStore.append({
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        actionId: action.id,
        authorizationTokenId: decision.tokenId,
        layer: "authorization",
        outcome: decision.allowed ? "allowed" : "denied",
        reason: decision.reasonCode,
        timestamp: now,
      });

      return decision;
    });
  }

  /**
   * Atomic budget consumption (BudgetService interface).
   * Budget-only check without scope/status evaluation.
   */
  async consumeIfAvailable(
    tokenId: string,
    amount: string,
    actionId: string,
  ): Promise<AuthorizationDecision> {
    // Validate amount is a positive integer string
    if (!validatePositiveIntegerString(amount)) {
      return {
        allowed: false,
        reasonCode: "BUDGET_EXCEEDED",
        message: "Invalid amount: must be a positive integer string",
        retryable: false,
        evaluatedAt: new Date().toISOString() as IsoDatetime,
      } satisfies AuthorizationDecision;
    }

    return this.withLock(tokenId, async () => {
      const now = new Date().toISOString() as IsoDatetime;
      const token = this.tokenStore.get(tokenId);
      if (!token) {
        return {
          allowed: false,
          reasonCode: "TOKEN_NOT_FOUND",
          message: "Authorization token not found",
          retryable: false,
          evaluatedAt: now,
        } satisfies AuthorizationDecision;
      }

      const spent = BigInt(await this.ledgerStore.sumByTokenId(tokenId));
      const limit = BigInt(token.budget.limit);
      const requested = BigInt(amount);

      if (limit - spent < requested) {
        return {
          allowed: false,
          reasonCode: "BUDGET_EXCEEDED",
          message: "Insufficient budget for this action",
          retryable: true,
          evaluatedAt: now,
          tokenId,
        } satisfies AuthorizationDecision;
      }

      await this.ledgerStore.append({
        id: `ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        tokenId,
        amount,
        actionId,
        timestamp: now,
      });

      return {
        allowed: true,
        reasonCode: "ALLOWED",
        message: "Authorization granted",
        retryable: false,
        evaluatedAt: now,
        tokenId,
      } satisfies AuthorizationDecision;
    });
  }

  /**
   * Get a token by ID (for inspection/testing).
   */
  getToken(id: string): AuthorizationToken | undefined {
    return this.tokenStore.get(id);
  }

  /**
   * Query audit records.
   */
  async getAuditLog(options?: AuditQueryOptions): Promise<AuditRecord[]> {
    return this.auditStore.list(options);
  }

  /**
   * Get audit records for a specific action.
   */
  async getAuditByActionId(actionId: string): Promise<AuditRecord[]> {
    return this.auditStore.findByActionId(actionId);
  }

  /**
   * Get audit records for a specific token.
   */
  async getAuditByTokenId(tokenId: string): Promise<AuditRecord[]> {
    return this.auditStore.findByTokenId(tokenId);
  }

  /**
   * Update a token's status (for suspend/revoke/reactivate).
   */
  updateTokenStatus(
    tokenId: string,
    status: AuthorizationToken["status"],
  ): void {
    const token = this.tokenStore.get(tokenId);
    if (!token) {
      throw new Error(`Token not found: ${tokenId}`);
    }
    this.tokenStore.set({ ...token, status });
  }
}
