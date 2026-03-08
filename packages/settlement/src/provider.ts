import type {
  SettlementProvider,
  SettlementProviderRegistry,
  SettlementResult,
} from "@agentbond/core";

/**
 * Mock provider that always succeeds without actual fund transfer.
 */
export const mockProvider: SettlementProvider = {
  name: "mock",
  async execute(): Promise<SettlementResult> {
    return {
      success: true,
      providerRef: undefined,
      txHash: undefined,
    };
  },
};

/**
 * In-memory registry for settlement providers.
 */
export class InMemoryProviderRegistry implements SettlementProviderRegistry {
  private readonly providers = new Map<string, SettlementProvider>();

  register(provider: SettlementProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): SettlementProvider | null {
    return this.providers.get(name) ?? null;
  }
}
