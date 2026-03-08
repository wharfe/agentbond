import type { IsoDatetime } from "./types.js";

// Uses ID references instead of full objects (reduces log volume and redundancy)
export interface AuditRecord {
  id: string;
  actionId: string;
  authorizationTokenId?: string;
  layer: "authorization" | "intent" | "contract" | "settlement";
  outcome: "allowed" | "denied" | "pending";
  reason?: string;
  timestamp: IsoDatetime;
}
