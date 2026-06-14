# Project Instructions

These instructions apply to the whole repository.

## Working Style

- Keep changes focused and consistent with the existing `src` and `tests`
  layout.
- Use `pnpm` for scripts and dependency updates. Do not switch package managers.
- Prefer typed, explicit code over broad implicit behavior, especially around
  GitLab, Git, config, and model-facing flows.
- Do not commit generated output such as `dist`, coverage reports, or local
  caches unless the task explicitly asks for it.

## Development Practice

- Use a test-first flow for behavior changes: write a focused failing test,
  verify it fails for the expected reason, implement the smallest fix, then
  refactor after the test is green.
- Keep the red-green-refactor cycle small; avoid bundling unrelated behavior
  into the same change.
- Keep unit tests next to the source they cover.
- Put CLI and end-to-end behavior tests in `tests/`.
- Prefer small, focused modules over large catch-all files.
- Use the project-local `gitlab-workflow` skill only when the user explicitly
  asks to use the GitLab workflow.

## Review Feedback

- Evaluate review threads for correctness and necessity before changing code.
- After applying a technically sound fix, push the change, reply to the thread
  with the fix and validation, and mark the thread resolved.
- Before handing off a merge request, drive resolvable review threads to
  `0` open threads. If a thread should not be fixed, reply with the technical
  rationale and ask the user or reviewer before leaving it unresolved.

## Worktree Safety

- Follow the relevant superpowers workflow for isolated workspaces before
  feature work, including detecting whether the current checkout is already
  isolated.
- Do not commit directly on `main`.
- Preserve unrelated user changes, and do not stage, commit, rewrite, or revert
  them unless explicitly requested.

## Validation

Run the smallest useful check for the change. For broad code changes, prefer:

```sh
pnpm check
```

For narrower work, use the relevant typecheck, lint, or test command. Add or
update Vitest coverage when behavior changes.

## Documentation

Keep documentation concise. When changing behavior, update docs near the
affected workflow if users or future agents need to know about it.
