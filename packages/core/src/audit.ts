import type { IsoDatetime } from "./types.js";

// Uses ID references instead of full objects (reduces log volume and redundancy)
export interface AuditRecord {
  id: string;
  actionId: string;
  authorizationTokenId?: string;
  intentRef?: string;
  contractId?: string;
  settlementId?: string;
  layer: "authorization" | "intent" | "contract" | "settlement";
  outcome: "allowed" | "denied" | "pending";
  reason?: string;
  timestamp: IsoDatetime;
}

// Storage adapter interface for AuditRecord persistence
export interface AuditRecordStore {
  append(record: AuditRecord): Promise<void>;
  findByActionId(actionId: string): Promise<AuditRecord[]>;
  findByTokenId(tokenId: string): Promise<AuditRecord[]>;
  list(options?: AuditQueryOptions): Promise<AuditRecord[]>;
}

export interface AuditQueryOptions {
  layer?: AuditRecord["layer"];
  outcome?: AuditRecord["outcome"];
  since?: IsoDatetime;
  until?: IsoDatetime;
  limit?: number;
}
