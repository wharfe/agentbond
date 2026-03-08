import type {
  SettlementDecision,
  SettlementReasonCode,
  SettlementProviderRegistry,
  SettlementRequest,
  SettlementRecord,
  IsoDatetime,
} from "@agentbond/core";

export interface ExecutionContext {
  providerRegistry: SettlementProviderRegistry;
}

const MESSAGES: Record<SettlementReasonCode, string> = {
  ALLOWED: "Settlement completed successfully",
  SETTLEMENT_NOT_FOUND: "Settlement record not found",
  PROVIDER_NOT_FOUND: "Specified settlement provider is not registered",
  PROVIDER_ERROR: "Settlement provider returned an error",
  CONTRACT_NOT_FOUND: "Specified contract not found",
  CONTRACT_NOT_COMPLETED: "Contract must be completed before settlement",
  INVALID_INPUT: "Invalid input: see error details",
};

const RETRYABLE: Record<SettlementReasonCode, boolean> = {
  ALLOWED: false,
  SETTLEMENT_NOT_FOUND: false,
  PROVIDER_NOT_FOUND: false,
  PROVIDER_ERROR: true,
  CONTRACT_NOT_FOUND: false,
  CONTRACT_NOT_COMPLETED: true,
  INVALID_INPUT: false,
};

/**
 * Execute a settlement request via the specified provider.
 * Returns the SettlementRecord and decision.
 */
export async function executeSettlement(
  ctx: ExecutionContext,
  request: SettlementRequest,
  providerName: string,
  now: IsoDatetime,
): Promise<{ record: SettlementRecord; decision: SettlementDecision }> {
  const provider = ctx.providerRegistry.get(providerName);
  if (!provider) {
    return {
      record: {
        id: request.id,
        request,
        result: { success: false, error: "Provider not found" },
        provider: providerName,
        status: "failed",
        createdAt: now,
      },
      decision: makeDecision("PROVIDER_NOT_FOUND", now, request.id),
    };
  }

  try {
    const result = await provider.execute(request);

    if (!result.success) {
      return {
        record: {
          id: request.id,
          request,
          result,
          provider: providerName,
          status: "failed",
          createdAt: now,
        },
        decision: makeDecision("PROVIDER_ERROR", now, request.id),
      };
    }

    return {
      record: {
        id: request.id,
        request,
        result,
        provider: providerName,
        status: "completed",
        createdAt: now,
      },
      decision: makeDecision("ALLOWED", now, request.id),
    };
  } catch {
    return {
      record: {
        id: request.id,
        request,
        result: { success: false, error: "Provider execution failed" },
        provider: providerName,
        status: "failed",
        createdAt: now,
      },
      decision: makeDecision("PROVIDER_ERROR", now, request.id),
    };
  }
}

export function makeDecision(
  reasonCode: SettlementReasonCode,
  evaluatedAt: IsoDatetime,
  settlementId?: string,
): SettlementDecision {
  return {
    allowed: reasonCode === "ALLOWED",
    reasonCode,
    message: MESSAGES[reasonCode],
    retryable: RETRYABLE[reasonCode],
    evaluatedAt,
    settlementId,
  };
}
