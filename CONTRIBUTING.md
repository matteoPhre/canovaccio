# Contributing

## Prerequisites

- Node.js 22 or newer
- npm

Install dependencies with:

```sh
npm ci
```

## Development workflow

Create feature branches from `develop` using the `feature/<short-description>` convention. Open pull requests back to `develop`; do not commit directly to `main`.

Use Conventional Commits:

```text
<type>(<scope>): <short description>
```

Common types are `feat`, `fix`, `test`, `refactor`, `docs`, and `chore`. Keep the subject imperative, under 72 characters, and without a trailing period.

## Quality checks

Run all checks before opening a pull request:

```sh
npm exec tsc -- --noEmit
npm test
npm run build
```

New behaviour should include focused Vitest coverage. Keep the package framework-agnostic, avoid runtime dependencies, and inject external concerns such as persistence, logging, and transport.

## Pull requests

Describe what changed, why it changed, and how it was tested. CI must pass before merge. Squash merge feature branches into `develop`; releases merge into both `main` and `develop`.