# @agentbond/auth

Authorization engine for [agentbond](https://github.com/wharfe/agentbond) — token issuance, evaluation, and budget management for AI agents.

## Installation

```bash
npm install @agentbond/auth
```

## Usage

```typescript
import { AuthService } from "@agentbond/auth";
import type { AuthorizationToken, AgentAction } from "@agentbond/core";

const service = new AuthService();

// Issue a root token
const token: AuthorizationToken = {
  id: "token-1",
  issuedBy: { id: "human-1", type: "human" },
  issuedTo: { id: "agent-1", type: "ai" },
  scopes: [{ domain: "api.stripe.com", operations: ["read"] }],
  budget: { limit: "1000", currency: "credits" },
  expiry: "2099-01-01T00:00:00Z",
  status: "active",
};

await service.issueToken(token);

// Evaluate an action
const action: AgentAction = {
  id: "action-1",
  actor: { id: "agent-1", type: "ai" },
  scope: { domain: "api.stripe.com", operations: ["read"] },
  timestamp: new Date().toISOString(),
};

const result = await service.evaluateAndConsume("token-1", action, "10");
// result.allowed === true
// result.reasonCode === "ALLOWED"
```

## Features

- **Token Issuance** with delegation constraint validation
- **Authorization Evaluation** following a strict 8-step evaluation order
- **Budget Management** with atomic consume-if-available operations
- **Cascade Revocation** via evaluation-time parent chain reference
- **Per-token Locking** for safe concurrent budget consumption

## License

MIT
