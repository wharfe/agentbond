import type { IntentRecord, IntentStore } from "@agentbond/core";

export class InMemoryIntentStore implements IntentStore {
  private readonly records = new Map<string, IntentRecord>();
  private readonly actionIndex = new Map<string, string>();

  async save(record: IntentRecord): Promise<void> {
    if (this.records.has(record.id)) {
      throw new Error(`IntentRecord with id '${record.id}' already exists`);
    }
    if (this.actionIndex.has(record.actionId)) {
      throw new Error(
        `IntentRecord for actionId '${record.actionId}' already exists`,
      );
    }
    this.records.set(record.id, record);
    this.actionIndex.set(record.actionId, record.id);
  }

  async findById(id: string): Promise<IntentRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findByActionId(actionId: string): Promise<IntentRecord | null> {
    const id = this.actionIndex.get(actionId);
    if (!id) return null;
    return this.records.get(id) ?? null;
  }
}
