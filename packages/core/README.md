# @agentbond/core

Core type definitions for [agentbond](https://github.com/wharfe/agentbond) — agent-first governance infrastructure for AI agents.

## Installation

```bash
npm install @agentbond/core
```

## What's Included

This package provides TypeScript interfaces and types shared across the agentbond ecosystem:

- **`AgentIdentity`** — Agent identification
- **`AgentAction`** / **`ActionScope`** — Action representation
- **`AuthorizationToken`** / **`AuthorizationDecision`** — Authorization primitives
- **`Budget`** / **`BudgetLedgerEntry`** — Budget management
- **`IntentRecord`** / **`IntentPolicy`** — Intent proof (future)
- **`Contract`** / **`ContractParty`** — Inter-agent contracts (future)
- **`SettlementHook`** / **`SettlementRecord`** — Settlement (future)
- **`AuditRecord`** — Audit trail

## Usage

```typescript
import type { AuthorizationToken, AgentIdentity } from "@agentbond/core";
```

## License

MIT
