# @agentbond/settlement

Settlement layer for [agentbond](https://github.com/wharfe/agentbond) — inter-agent payment and settlement for AI agents.

## Installation

```bash
npm install @agentbond/settlement
```

## Usage

```typescript
import { SettlementService } from "@agentbond/settlement";

const service = new SettlementService();

// Create a settlement request
const record = await service.createSettlement({
  contractId: "contract-1",
  amount: "100",
  currency: "credits",
  payerId: "agent-a",
  payeeId: "agent-b",
  provider: "mock",
});

// Execute settlement
const result = await service.executeSettlement(record.id);

if (result.decision.allowed) {
  console.log(result.record.status); // "completed"
}
```

## Features

- **Settlement Execution** with pluggable payment providers
- **Provider Registry** — register and resolve settlement providers
- **Contract Integration** — link settlements to contract fulfillment
- **Audit Trail Integration** — optional audit store for all operations
- **Mock Provider** included for testing

## License

MIT
