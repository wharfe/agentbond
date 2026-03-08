import type { Contract, ContractStore } from "@agentbond/core";

export class InMemoryContractStore implements ContractStore {
  private readonly contracts = new Map<string, Contract>();

  async save(contract: Contract): Promise<void> {
    this.contracts.set(contract.id, contract);
  }

  async findById(id: string): Promise<Contract | null> {
    return this.contracts.get(id) ?? null;
  }

  async findByPartyId(agentId: string): Promise<Contract[]> {
    const results: Contract[] = [];
    for (const contract of this.contracts.values()) {
      if (contract.parties.some((p) => p.agent.id === agentId)) {
        results.push(contract);
      }
    }
    return results;
  }
}
