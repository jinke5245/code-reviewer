# Development

This project uses Node.js, pnpm, TypeScript, Vitest, ESLint, Prettier, and
Husky.

Install dependencies:

```sh
pnpm install
```

Run the CLI during development:

```sh
pnpm dev
```

Run the full local check:

```sh
pnpm check
```

Run individual checks:

```sh
pnpm typecheck
pnpm lint
pnpm test
```

Live OpenAI-compatible integration tests are skipped by default. To run them
against your configured model endpoint, opt in explicitly:

```sh
RUN_LIVE_OPENAI_TESTS=true pnpm test tests/integration/openai-compatible-live.test.ts
```

Test layout:

- `tests/unit`: isolated module and CLI behavior tests.
- `tests/integration`: GitLab, model, and end-to-end review flow tests.

Build TypeScript output:

```sh
pnpm build
```

Bundle the executable CLI:

```sh
pnpm bundle
```
