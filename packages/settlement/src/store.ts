import type { SettlementRecord, SettlementStore } from "@agentbond/core";

export class InMemorySettlementStore implements SettlementStore {
  private readonly records = new Map<string, SettlementRecord>();

  async save(record: SettlementRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async findById(id: string): Promise<SettlementRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findByContractId(contractId: string): Promise<SettlementRecord[]> {
    const results: SettlementRecord[] = [];
    for (const record of this.records.values()) {
      if (record.request.contractId === contractId) {
        results.push(record);
      }
    }
    return results;
  }
}
