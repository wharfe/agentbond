# CLAUDE.md

## About this repository

agentbond is an agent-first governance infrastructure for AI agents.
It handles authorization, intent proof, contracts, and settlement.

- Package scope: `@agentbond/*`
- Monorepo: pnpm workspaces + turborepo
- Language: TypeScript (ESM)
- Runtime: Node.js >= 20
- Test framework: vitest
- License: MIT

## Suite Position

This repository is **Authorization Substrate** in the [Agent Trust Suite](https://github.com/wharfe/agent-trust-suite).

- **Does:** Governance infrastructure for autonomous AI agents. Provides authorization (token-based permissions, budget control, delegation), intent tracking, contract lifecycle management, and settlement. Exposes 17 tools via MCP Server.
- **Does not:** Define behavioral contracts (that's agentcontract) or collect runtime telemetry (that's agent-trust-telemetry).
- **Install:** Published to npm. `npx @agentbond/mcp-server` or `npm install @agentbond/auth`
- **Suite navigation:** See [AGENTS.md](https://github.com/wharfe/agent-trust-suite/blob/main/AGENTS.md) for full component map.

## Architecture

```
┌─────────────────────────────────────┐
│  Contract Layer                     │  Inter-agent agreements
├─────────────────────────────────────┤
│  Authorization Layer   ← MVP       │  Who can do what
├─────────────────────────────────────┤
│  Intent Layer                       │  Why an action was taken
├─────────────────────────────────────┤
│  Settlement Layer                   │  Payment and settlement
└─────────────────────────────────────┘
```

## Packages

| Package | Path | Description |
|---|---|---|
| `@agentbond/core` | `packages/core` | Type definitions and shared interfaces |
| `@agentbond/auth` | `packages/auth` | Authorization engine |
| `@agentbond/intent` | `packages/intent` | Intent proof layer |
| `@agentbond/contract` | `packages/contract` | Contract layer |
| `@agentbond/settlement` | `packages/settlement` | Settlement execution layer |
| `@agentbond/mcp-server` | `mcp-server` | MCP server (17 tools) |

## Implementation Rules

- Type-only files must NOT contain implementation logic
- Stop and ask when encountering ambiguity
- Follow Conventional Commits for all commit messages
- Code comments in English, communication in Japanese
- Do NOT over-engineer — implement only what is specified

## Design Constitution (5 Principles)

1. **Discoverability** — Agents discover and understand tools without human help
2. **Predictability** — Same input always produces same output
3. **Least Privilege** — Only grant necessary permissions
4. **Auditability** — All actions are verifiable after the fact
5. **Zero Breaking Changes** — Core interfaces maintain backward compatibility

## Commands

```bash
pnpm build        # Build all packages
pnpm test         # Run all tests
pnpm typecheck    # Type check all packages
pnpm lint         # Lint all packages
pnpm changeset    # Add a changeset for release
```

## Commit Convention

```
feat(auth): add token revocation endpoint
fix(core): correct ISO datetime validation
docs: update authorization spec
chore: update dependencies
test(auth): add TC-07 parent revocation test
```
