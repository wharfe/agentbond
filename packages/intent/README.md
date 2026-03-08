# @agentbond/intent

Intent proof layer for [agentbond](https://github.com/wharfe/agentbond) — intent recording, evaluation, and audit integration for AI agents.

## Installation

```bash
npm install @agentbond/intent
```

## Usage

```typescript
import { IntentService } from "@agentbond/intent";

const service = new IntentService();

// Evaluate intent and record it atomically
const result = await service.evaluateAndRecord({
  actionId: "action-1",
  tokenId: "token-1",
  intentPolicy: {
    requireIntent: true,
    maxPendingMs: 60_000,
  },
});

if (result.decision.allowed) {
  // Intent was valid and recorded
  console.log(result.record.id);
}

// Query intent by action ID
const record = await service.getByActionId("action-1");
```

## Features

- **Intent Evaluation** against configurable policies
- **Atomic Record & Evaluate** — evaluate and persist in a single call
- **Pending Intent Support** with configurable TTL
- **Audit Trail Integration** — optional audit store for all operations
- **Action-to-Intent Lookup** — query intent records by action ID

## License

MIT
