import type { BudgetLedgerEntry, BudgetLedgerStore } from "@agentbond/core";

export class InMemoryBudgetLedgerStore implements BudgetLedgerStore {
  private readonly entries: BudgetLedgerEntry[] = [];

  async append(entry: BudgetLedgerEntry): Promise<void> {
    this.entries.push(entry);
  }

  async sumByTokenId(tokenId: string): Promise<string> {
    let sum = 0n;
    for (const entry of this.entries) {
      if (entry.tokenId === tokenId) {
        sum += BigInt(entry.amount);
      }
    }
    return sum.toString();
  }
}
