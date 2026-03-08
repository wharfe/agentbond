import type {
  AuditRecord,
  AuditRecordStore,
  AuditQueryOptions,
} from "@agentbond/core";

export class InMemoryAuditRecordStore implements AuditRecordStore {
  private readonly records: AuditRecord[] = [];

  async append(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }

  async findByActionId(actionId: string): Promise<AuditRecord[]> {
    return this.records.filter((r) => r.actionId === actionId);
  }

  async findByTokenId(tokenId: string): Promise<AuditRecord[]> {
    return this.records.filter((r) => r.authorizationTokenId === tokenId);
  }

  async list(options?: AuditQueryOptions): Promise<AuditRecord[]> {
    let results = this.records;

    if (options?.layer) {
      results = results.filter((r) => r.layer === options.layer);
    }
    if (options?.outcome) {
      results = results.filter((r) => r.outcome === options.outcome);
    }
    if (options?.since) {
      const since = new Date(options.since).getTime();
      results = results.filter((r) => new Date(r.timestamp).getTime() >= since);
    }
    if (options?.until) {
      const until = new Date(options.until).getTime();
      results = results.filter((r) => new Date(r.timestamp).getTime() <= until);
    }
    if (options?.limit !== undefined) {
      results = results.slice(0, options.limit);
    }

    return results;
  }
}
