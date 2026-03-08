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

| Package | Path | Status |
|---|---|---|
| `@agentbond/core` | `packages/core` | Step 1 — Type definitions |
| `@agentbond/auth` | `packages/auth` | Step 2 — Authorization engine |

## Implementation Rules

- Type-only files must NOT contain implementation logic
- Do NOT add fields not defined in the spec
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

## Required Reading

- `docs/HANDOFF.md` — Architecture, interfaces, implementation steps
- `docs/authorization.spec.md` — Authorization logic specification (single source of truth)
- `docs/oss-dev-guidelines.md` — OSS conventions

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
