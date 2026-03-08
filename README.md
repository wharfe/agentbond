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

```bash
npm install @agentbond/core @agentbond/auth
```

```typescript
import type { AuthorizationToken } from "@agentbond/core";
// Full usage examples coming with @agentbond/auth implementation
```

## Packages

| Package | Description | Status |
|---|---|---|
| [`@agentbond/core`](./packages/core) | Core type definitions and shared interfaces | 🚧 In development |
| [`@agentbond/auth`](./packages/auth) | Authorization engine — token issuance, evaluation, budget management | 🚧 In development |

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

## Status

**Phase: MVP (v0.x)** — Core types and authorization engine under active development.

The API is not yet stable. Breaking changes may occur before v1.0.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](./LICENSE)
