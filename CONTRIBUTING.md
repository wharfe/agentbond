# Contributing to agentbond

Thank you for your interest in contributing to agentbond!

## Development Setup

```bash
# Clone the repository
git clone https://github.com/wharfe/agentbond.git
cd agentbond

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck
```

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

```
feat(auth): add token revocation endpoint
fix(core): correct ISO datetime validation
docs: update llms.txt with new tool descriptions
chore: update dependencies
```

## Adding a Changeset

When your change affects a published package, add a changeset:

```bash
pnpm changeset
```

## Pull Requests

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Run `pnpm typecheck && pnpm test && pnpm lint`
5. Add a changeset if applicable
6. Submit a pull request

## Design Principles

All contributions should align with the [design constitution](docs/HANDOFF.md):

1. **Discoverability** — Agents can discover and understand tools autonomously
2. **Predictability** — Same input produces same output
3. **Least Privilege** — Only necessary permissions
4. **Auditability** — All actions are verifiable
5. **Zero Breaking Changes** — Core interfaces maintain backward compatibility

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
