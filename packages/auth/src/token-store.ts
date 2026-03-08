import type { AuthorizationToken } from "@agentbond/core";

export interface TokenStore {
  get(id: string): AuthorizationToken | undefined;
  set(token: AuthorizationToken): void;
}

export class InMemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, AuthorizationToken>();

  get(id: string): AuthorizationToken | undefined {
    return this.tokens.get(id);
  }

  set(token: AuthorizationToken): void {
    this.tokens.set(token.id, token);
  }
}
