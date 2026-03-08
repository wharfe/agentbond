import type { ActionScope } from "@agentbond/core";

/**
 * Check if an action scope matches any of the token scopes.
 * Scope array uses OR evaluation — match on any one scope passes.
 */
export function matchesScope(
  tokenScopes: ActionScope[],
  actionScope: ActionScope,
): boolean {
  return tokenScopes.some((ts) => matchesSingleScope(ts, actionScope));
}

function matchesSingleScope(
  tokenScope: ActionScope,
  actionScope: ActionScope,
): boolean {
  // Domain: exact match only (case-sensitive)
  if (tokenScope.domain !== actionScope.domain) {
    return false;
  }

  // Operations: all requested operations must exist in token scope
  for (const op of actionScope.operations) {
    if (!tokenScope.operations.includes(op)) {
      return false;
    }
  }

  // Resources: if token has no resources constraint, allow any resource
  if (tokenScope.resources === undefined) {
    return true;
  }

  // If action has no resources, it passes (resource-independent action)
  if (actionScope.resources === undefined) {
    return true;
  }

  // Every requested resource must match at least one token resource pattern
  for (const resource of actionScope.resources) {
    if (!tokenScope.resources.some((pattern) => globMatch(pattern, resource))) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a child scope is a valid subset of parent scopes.
 * MVP simplified rules (Section 2.3):
 * - domain must exact-match a parent scope
 * - operations must be a subset of that parent scope
 * - resources must be identical patterns or concrete strings matching parent patterns
 */
export function isScopeSubset(
  parentScopes: ActionScope[],
  childScope: ActionScope,
): boolean {
  // Find a parent scope with matching domain
  const matchingParent = parentScopes.find(
    (ps) => ps.domain === childScope.domain,
  );
  if (!matchingParent) {
    return false;
  }

  // Child operations must be a subset of parent operations
  for (const op of childScope.operations) {
    if (!matchingParent.operations.includes(op)) {
      return false;
    }
  }

  // If parent has no resource constraint, child can have anything
  if (matchingParent.resources === undefined) {
    return true;
  }

  // If child has no resource constraint but parent does, that widens scope
  if (childScope.resources === undefined) {
    return false;
  }

  // Each child resource must be either:
  // - An identical pattern from the parent
  // - A concrete string that matches a parent pattern
  for (const childRes of childScope.resources) {
    const isIdenticalPattern = matchingParent.resources.includes(childRes);
    if (isIdenticalPattern) {
      continue;
    }

    // Check if it's a concrete string (no glob characters) that matches a parent pattern
    if (containsGlobChars(childRes)) {
      // Re-patterning is not allowed in MVP
      return false;
    }

    const matchesParentPattern = matchingParent.resources.some((pattern) =>
      globMatch(pattern, childRes),
    );
    if (!matchesParentPattern) {
      return false;
    }
  }

  return true;
}

function containsGlobChars(s: string): boolean {
  return s.includes("*") || s.includes("?");
}

/**
 * Simple glob matching:
 * - `*` matches any characters within a single path segment (not `/`)
 * - `**` matches any characters including `/` (multiple segments)
 */
export function globMatch(pattern: string, value: string): boolean {
  const regexStr = globToRegex(pattern);
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(value);
}

function globToRegex(pattern: string): string {
  let result = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      result += ".*";
      i += 2;
      // Skip trailing slash after **
      if (pattern[i] === "/") {
        i++;
      }
    } else if (pattern[i] === "*") {
      result += "[^/]*";
      i++;
    } else if (pattern[i] === "?") {
      result += "[^/]";
      i++;
    } else {
      result += escapeRegex(pattern[i]!);
      i++;
    }
  }
  return result;
}

function escapeRegex(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
