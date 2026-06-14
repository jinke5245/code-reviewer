---
name: github-workflow
description: >
  Use GitHub CLI to run issue-first, pull-request-based development workflows:
  create semantic issues, issue-prefixed branches, linked pull requests,
  focused commits, review-feedback fixes, and merge-ready PRs.
---

# GitHub Workflow

## When To Use

Use this skill when a user asks an agent to make repository changes in a GitHub
project and the work should be tracked through GitHub issues and pull requests.

Use it for implementation, documentation, tooling, repository-maintenance, and
skill-authoring tasks.

Do not use it for read-only investigation unless the user asks to create GitHub
tracking artifacts.

## Principles

- All committed code changes must go through a pull request.
- Keep pull requests small, focused, and easy to review.
- Split large features into smaller issues and pull requests before editing.
- Treat configured GitHub issue and pull request templates as the source of
  truth for GitHub artifact content.
- Default to English for issue titles, pull request titles, branch names, and
  commit messages. Repository instructions and project conventions take
  precedence over user preference. Use another language for those
  identifier-like artifacts only when it does not conflict with repository
  rules and the user explicitly requests that language for those artifacts.
- Default to English for issue descriptions, pull request descriptions, and
  review summaries, but follow repository instructions and project conventions
  first, then the user's requested language when provided.
- Use semantic titles and commit messages:

```text
<type>: <short imperative summary>
```

Prefer these types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`,
`build`, `perf`.

## Template Discovery

Before creating GitHub artifacts, inspect the repository for templates in common
GitHub-supported locations.

Issue templates:

- Prefer matching issue forms or Markdown templates in `.github/ISSUE_TEMPLATE/`.
- For GitHub issue forms, use the interactive or web flow so required form
  fields are preserved.
- Also respect legacy single-file templates such as `ISSUE_TEMPLATE.md`,
  `docs/ISSUE_TEMPLATE.md`, and `.github/ISSUE_TEMPLATE.md` when present.

Pull request templates:

- Use single-file templates such as `PULL_REQUEST_TEMPLATE.md`,
  `docs/PULL_REQUEST_TEMPLATE.md`, and `.github/PULL_REQUEST_TEMPLATE.md`.
- If `PULL_REQUEST_TEMPLATE/` exists under the repository root, `docs/`, or
  `.github/`, choose the focused template that best matches the issue template,
  requested change type, or pull request scope.
- If no focused pull request template matches, use the default pull request
  template when one exists.

## Required Sequence

1. Inspect repository instructions such as `AGENTS.md`, `README.md`, GitHub
   templates, branch rules, and existing workflow conventions.
2. Inspect the current branch and worktree:

   ```bash
   git status --short --branch
   ```

3. If the task is too large for one focused pull request, propose a split before
   creating GitHub artifacts.
4. Draft the GitHub issue title and description.
   - Use a semantic English title unless the language rule above calls for
     another language.
   - Use the applicable issue template when one exists.
   - Fill the template's required sections before adding generic context such
     as goal, scope, acceptance criteria, and validation notes.
   - Show the draft issue content to the user and wait for approval before
     creating the issue, unless the user explicitly asked to skip review.
5. Create the issue from the approved draft content with `gh issue create`.
6. Create and switch to an issue-prefixed branch locally:

   ```text
   <issue-number>-<semantic-title-slug>
   ```

   Example:

   ```text
   12-feat-add-github-workflow-skill
   ```

7. Implement the requested change only on the issue branch.
8. Run relevant checks before committing.
9. Commit with a semantic English commit message unless the language rule above
   calls for another language.
10. Before pushing or requesting review, draft the pull request title and
    description.
    - Use a semantic English pull request title unless the language rule above
      calls for another language.
    - Use the matching pull request template as structure.
    - Combine the template with issue context, actual branch diffs or commits,
      and validation results.
    - Link the issue with `Closes #<issue-number>`.
    - Show the draft pull request content to the user and wait for approval
      before creating or updating the pull request, unless the user explicitly
      asked to skip review.
11. Push the branch.
12. Create or update a draft pull request linked to the issue.
13. Inspect pull request checks.
14. Address review feedback in focused follow-up commits or amended commits,
    according to the repository's preferred history style.
15. Wait for checks and review to complete before merging.

## Review Feedback Loop

When review comments or CI failures appear:

1. Read the pull request checks, review comments, and unresolved review threads.
2. Separate actionable feedback from informational comments.
3. Apply only the requested, scoped fixes.
4. Re-run the relevant checks.
5. Commit or amend as appropriate, then push.
6. Resolve only the review threads that were addressed when the user explicitly
   asked for thread resolution or asked to address review feedback end to end.
7. Request re-review when useful, according to the repository's review workflow.
8. Summarize what feedback was addressed and what remains open.

Do not resolve any review thread unless it satisfies step 6. Do not submit
reviews, approve, merge, or delete branches unless the user explicitly asks.

## Existing Local Work

If the user asks to commit, push, publish, or create a pull request for existing
local changes:

1. Inspect the current branch and worktree:

   ```bash
   git status --short --branch
   ```

2. Check whether the current branch already has a pull request:

   ```bash
   gh pr view
   ```

3. Preserve unrelated user changes, and later stage only files that belong to
   the current task.
4. If a matching pull request exists, reuse it and:
   - Validate the scoped changes.
   - Commit with a semantic English commit message unless the language rule
     above calls for another language.
   - Draft any needed pull request title or description updates from the
     matching template, issue context, scoped changes, and validation results.
   - Get user approval before updating the pull request.
   - Push the branch, then update the pull request when needed.
5. If no pull request exists but the branch already follows
   `<issue-number>-<semantic-title-slug>`, first verify that the prefixed issue
   number exists and matches the task.
   - If the prefixed issue matches, keep the existing branch.
   - If the prefixed issue does not exist or does not match, create or identify
     the correct issue, create an issue-prefixed branch for that issue, and move
     the scoped work there before committing.
   - Validate the scoped changes.
   - Commit with a semantic English commit message unless the language rule
     above calls for another language.
   - Draft the pull request title and description from the matching template,
     issue context, scoped changes, and validation results.
   - Get user approval before creating or updating the pull request.
   - Push the branch, then create or update the pull request.
6. If the branch does not follow the issue-branch format, do not commit
   directly. Create or identify the issue, create the issue branch, and move the
   scoped work there before committing.
7. If existing local changes are mixed, confirm the scoped subset before staging
   or moving work.

## Useful Commands

Create an issue from an issue form:

```bash
gh issue create --template <template-file> --web
```

Use an actual issue template filename from `.github/ISSUE_TEMPLATE/` for
`<template-file>`, such as `skill-update.yml`, `skill-new.yml`, or
`maintenance.yml`. Do not use `config.yml`. Use the web or interactive flow for
issue forms so required fields are preserved.

Create an issue from an approved Markdown body:

```bash
gh issue create \
  --title "<type>: <short imperative summary>" \
  --body-file <file>
```

Create an issue branch:

```bash
git switch -c <issue-number>-<semantic-title-slug>
```

Push the branch:

```bash
git push -u origin <issue-number>-<semantic-title-slug>
```

Create a draft pull request:

```bash
gh pr create \
  --draft \
  --base main \
  --head <issue-number>-<semantic-title-slug> \
  --title "<type>: <short imperative summary>" \
  --body-file <file>
```

Update an existing pull request description:

```bash
gh pr edit <pr-number> --body-file <file>
```

Inspect checks:

```bash
gh pr checks
```

Inspect pull request details:

```bash
gh pr view --json number,title,url,state,isDraft,reviewDecision,statusCheckRollup
```

## Failure Handling

- If `gh auth status` fails, ask the user to authenticate before creating or
  editing GitHub artifacts.
- If network or Git transport fails, retry once. If a local proxy is required,
  use the proxy settings provided by the user.
- If the current worktree has unrelated changes, preserve them and do not stage
  or commit them unless the user explicitly asks.
- If the current branch is `main`, create or identify a matching issue, using
  user-approved draft content for newly created issues, and create an issue
  branch before editing files.
- If a pull request already exists for the current branch and matches the task,
  reuse it instead of creating a duplicate.
