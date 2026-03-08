# agentbond

Agent-first governance infrastructure for AI agents — authorization, intent proof, contracts, and settlement.

## Why

As AI agents begin to act autonomously — making API calls, spending budgets, delegating tasks to other agents — we need infrastructure that makes their actions **observable, auditable, and controllable**.

agentbond provides the foundational data layer for agent governance:

- **Who** can do **what**, up to **how much** (Authorization)
- **Why** an action was taken (Intent Proof)
- **What** was agreed upon between agents (Contracts)
- **How** payment flows (Settlement)

This isn't about restricting agents. It's about making trust computable.

## Quick Start

### As an MCP Server

The fastest way to use agentbond is as an MCP server. Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "agentbond": {
      "command": "npx",
      "args": ["@agentbond/mcp-server"]
    }
  }
}
```

This gives your AI agent 9 tools for authorization token management, action evaluation, and audit logging.

### As a TypeScript Library

```bash
npm install @agentbond/core @agentbond/auth
```

```typescript
import { AuthService } from "@agentbond/auth";

const auth = new AuthService();

// 1. Issue a token — grant an agent permission to act
const token = await auth.issueToken({
  id: "token-1",
  issuedBy: { id: "principal", type: "human" },
  issuedTo: { id: "worker-agent", type: "ai" },
  scopes: [{ domain: "api.stripe.com", operations: ["read"], resources: ["/invoices/*"] }],
  budget: { limit: "5000", currency: "credits" },
  expiry: "2025-12-31T23:59:59Z",
  status: "active",
});

// 2. Evaluate an action — check permission and consume budget atomically
const decision = await auth.evaluateAndConsume(
  "token-1",
  {
    id: "action-1",
    actor: { id: "worker-agent", type: "ai" },
    scope: { domain: "api.stripe.com", operations: ["read"], resources: ["/invoices/inv_123"] },
    timestamp: new Date().toISOString(),
  },
  "100", // amount to consume
);

console.log(decision);
// {
//   allowed: true,
//   reasonCode: "ALLOWED",
//   message: "Authorization granted",
//   retryable: false,
//   evaluatedAt: "2025-03-08T...",
//   tokenId: "token-1"
// }

// 3. Delegate — issue a child token with narrower permissions
const childToken = await auth.issueToken({
  id: "child-token-1",
  parentTokenId: "token-1",
  issuedBy: { id: "worker-agent", type: "ai" },
  issuedTo: { id: "sub-agent", type: "ai" },
  scopes: [{ domain: "api.stripe.com", operations: ["read"], resources: ["/invoices/*"] }],
  budget: { limit: "1000", currency: "credits" }, // must not exceed parent
  expiry: "2025-12-31T23:59:59Z",
  status: "active",
});

// 4. Revoke — child tokens are denied via cascade evaluation
auth.updateTokenStatus("token-1", "revoked");

const denied = await auth.evaluateAndConsume(
  "child-token-1",
  {
    id: "action-2",
    actor: { id: "sub-agent", type: "ai" },
    scope: { domain: "api.stripe.com", operations: ["read"] },
    timestamp: new Date().toISOString(),
  },
  "50",
);

console.log(denied.reasonCode); // "PARENT_TOKEN_INACTIVE"
console.log(denied.retryable);  // true (parent might be reactivated)

// 5. Audit — query all authorization decisions
const log = await auth.getAuditLog({ outcome: "denied", limit: 10 });
```

### Intent Layer — Record Why Actions Were Taken

```typescript
import { IntentService } from "@agentbond/intent";

const intent = new IntentService();

// 1. Record an intent — explain why the agent is acting
const record = await intent.recordIntent({
  actionId: "action-1",
  tokenId: "token-1",
  evidence: [
    {
      type: "human-instruction",
      content: "User requested monthly invoice report",
    },
  ],
  createdAt: new Date().toISOString(),
});

// 2. Evaluate intent policy — check if reasoning is provided
const decision = await intent.evaluateAndRecord({
  actionId: "action-1",
  tokenId: "token-1",
  intentPolicy: { requireReasoning: true, auditLevel: "summary" },
});

console.log(decision);
// {
//   allowed: true,
//   reasonCode: "ALLOWED",
//   message: "Intent recorded successfully",
//   intentId: "intent-..."
// }

// Without an intent record, requireReasoning: true → denied
const denied = await intent.evaluateAndRecord({
  actionId: "action-no-intent",
  tokenId: "token-1",
  intentPolicy: { requireReasoning: true, auditLevel: "summary" },
});

console.log(denied.reasonCode); // "INTENT_REQUIRED"
console.log(denied.retryable);  // true (record intent, then retry)
```

## Authorization Decision Codes

Every evaluation returns a machine-readable `AuthorizationDecision`:

| Code | Meaning | Retryable |
|---|---|---|
| `ALLOWED` | Authorization granted | — |
| `TOKEN_NOT_FOUND` | Token does not exist | No |
| `TOKEN_EXPIRED` | Token has expired | No |
| `TOKEN_REVOKED` | Token has been revoked | No |
| `TOKEN_SUSPENDED` | Token is suspended | Yes |
| `SCOPE_MISMATCH` | Action outside authorized scope | No |
| `BUDGET_EXCEEDED` | Insufficient budget | Yes |
| `PARENT_TOKEN_INACTIVE` | Parent token is not active | Yes |
| `PARENT_SCOPE_EXCEEDED` | Action exceeds parent scope | No |
| `PARENT_BUDGET_EXCEEDED` | Budget exceeds parent remaining | No |

## Intent Decision Codes

Every intent evaluation returns a machine-readable `IntentDecision`:

| Code | Meaning | Retryable |
|---|---|---|
| `ALLOWED` | Intent recorded successfully | — |
| `INTENT_REQUIRED` | Intent record required by policy but not provided | Yes |
| `INTENT_NOT_FOUND` | Specified intent record not found | No |
| `INVALID_INPUT` | Invalid input | No |

## Packages

| Package | Description | Version |
|---|---|---|
| [`@agentbond/core`](./packages/core) | Core type definitions and shared interfaces | [![npm](https://img.shields.io/npm/v/@agentbond/core)](https://www.npmjs.com/package/@agentbond/core) |
| [`@agentbond/auth`](./packages/auth) | Authorization engine — token issuance, evaluation, budget management | [![npm](https://img.shields.io/npm/v/@agentbond/auth)](https://www.npmjs.com/package/@agentbond/auth) |
| [`@agentbond/intent`](./packages/intent) | Intent layer — intent recording, evaluation, and audit integration | [![npm](https://img.shields.io/npm/v/@agentbond/intent)](https://www.npmjs.com/package/@agentbond/intent) |
| [`@agentbond/mcp-server`](./mcp-server) | MCP server — expose agentbond as MCP tools | [![npm](https://img.shields.io/npm/v/@agentbond/mcp-server)](https://www.npmjs.com/package/@agentbond/mcp-server) |

## Architecture

```
┌─────────────────────────────────────┐
│  Contract Layer                     │  Inter-agent agreements and conditions
├─────────────────────────────────────┤
│  Authorization Layer   ← MVP       │  Who can do what, with what budget
├─────────────────────────────────────┤
│  Intent Layer                       │  Why an action was taken
├─────────────────────────────────────┤
│  Settlement Layer                   │  Actual payment and settlement
└─────────────────────────────────────┘
```

All layers share the central concept of `AgentAction`.

## Design Principles

1. **Discoverability** — Agents discover and understand tools without human explanation
2. **Predictability** — Same input always produces same output; errors are machine-readable
3. **Least Privilege** — Only grant the permissions that are needed
4. **Auditability** — Every action is verifiable after the fact
5. **Zero Breaking Changes** — Core interfaces maintain backward compatibility

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](./LICENSE)
