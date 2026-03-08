import type { AuthorizationToken } from "@agentbond/core";
import { isScopeSubset } from "./scope.js";
import type { TokenStore } from "./token-store.js";
import { validateIsoDatetime, validatePositiveIntegerString } from "./validator.js";

export interface IssueTokenParams {
  token: AuthorizationToken;
}

export interface IssuerDeps {
  tokenStore: TokenStore;
  getSpent: (tokenId: string) => Promise<string>;
}

/**
 * Issue a new authorization token.
 * If the token has a parentTokenId, delegation constraints are validated.
 * Throws on constraint violation (Section 2).
 */
export async function issueToken(
  deps: IssuerDeps,
  params: IssueTokenParams,
): Promise<AuthorizationToken> {
  const { token } = params;

  // Validate required numeric and time fields regardless of parent
  if (!validatePositiveIntegerString(token.budget.limit)) {
    throw new Error(
      "Token budget limit must be a positive integer string",
    );
  }
  if (!validateIsoDatetime(token.expiry)) {
    throw new Error(
      "Token expiry must be a valid RFC 3339 datetime string",
    );
  }

  if (token.parentTokenId) {
    const parent = deps.tokenStore.get(token.parentTokenId);
    if (!parent) {
      throw new Error(
        `Parent token not found: ${token.parentTokenId}`,
      );
    }

    // Validate scope subset (Section 2.3)
    for (const childScope of token.scopes) {
      if (!isScopeSubset(parent.scopes, childScope)) {
        throw new Error(
          "Child token scopes must be a subset of parent token scopes",
        );
      }
    }

    // Validate budget: child limit <= parent remaining balance
    const parentSpent = BigInt(await deps.getSpent(parent.id));
    const parentRemaining = BigInt(parent.budget.limit) - parentSpent;
    const childLimit = BigInt(token.budget.limit);
    if (childLimit > parentRemaining) {
      throw new Error(
        "Child token budget limit exceeds parent token remaining balance",
      );
    }

    // Validate expiry: child expiry <= parent expiry
    if (
      new Date(token.expiry).getTime() > new Date(parent.expiry).getTime()
    ) {
      throw new Error(
        "Child token expiry must not exceed parent token expiry",
      );
    }
  }

  deps.tokenStore.set(token);
  return token;
}
