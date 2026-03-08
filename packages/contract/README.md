# @agentbond/contract

Contract layer for [agentbond](https://github.com/wharfe/agentbond) — inter-agent task delegation agreements for AI agents.

## Installation

```bash
npm install @agentbond/contract
```

## Usage

```typescript
import { ContractService } from "@agentbond/contract";

const service = new ContractService();

// Create a contract between agents
const contract = await service.createContract({
  parties: [
    { agentId: "agent-a", role: "requester" },
    { agentId: "agent-b", role: "provider" },
  ],
  terms: {
    description: "Translate document from English to Japanese",
    deliverables: ["translated-doc"],
  },
  tokenId: "token-1",
});

// Transition contract through its lifecycle
// draft → proposed → accepted → fulfilled
await service.transitionContract({
  contractId: contract.id,
  to: "proposed",
  actor: "agent-a",
});
```

## Features

- **Contract Lifecycle** — draft, proposed, accepted, fulfilled, cancelled, disputed
- **State Machine Validation** — only valid transitions are allowed
- **Multi-party Agreements** — requester and provider roles
- **Evaluation Engine** — evaluate contracts against configurable rules
- **Audit Trail Integration** — optional audit store for all state transitions

## License

MIT
