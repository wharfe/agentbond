export interface AgentIdentity {
  id: string; // UUIDv7 recommended (future DID migration path via publicKey)
  type: "human" | "ai" | "service";
  publicKey?: string; // For future signature verification
  metadata?: Record<string, unknown>;
}
