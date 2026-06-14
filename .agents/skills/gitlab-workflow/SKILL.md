---
name: gitlab-workflow
description: >
  Use GitLab CLI to run issue-first, merge-request-based development workflows:
  create semantic issues, early linked draft merge requests, GitLab-created
  related branches, focused commits, review-feedback fixes, and merge-ready
  MRs.
---

# GitLab Workflow

## When To Use

Use this skill when a user asks an agent to make repository changes in a GitLab
project and the work should be tracked through GitLab issues and merge requests.

Use it for implementation, documentation, tooling, repository-maintenance, and
skill-authoring tasks.

Do not use it for read-only investigation unless the user asks to create GitLab
tracking artifacts.

## Principles

- All committed code changes must go through a merge request.
- Keep merge requests small, focused, and easy to review.
- Split large features into smaller issues and merge requests before editing.
- Treat configured GitLab issue and merge request templates as the source of
  truth for GitLab artifact content.
- Default to English for issue titles, merge request titles, branch names, and
  commit messages. Use another language for those identifier-like artifacts only
  when repository instructions, project conventions, or the user explicitly
  requests that language for those artifacts.
- Default to English for issue descriptions, merge request descriptions, and
  review summaries, but follow repository instructions, project conventions, or
  the user's requested language when provided.
- Use semantic titles and commit messages:

```text
<type>: <short imperative summary>
```

Prefer these types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`,
`build`, `perf`.

## Template Discovery

Before creating GitLab artifacts, inspect the repository for templates and
project workflow conventions.

Issue templates:

- Prefer matching templates in `.gitlab/issue_templates/`.
- Use `glab issue create --template <template-name>` when a local issue
  template applies.
- Also respect project-level default issue templates when they are visible in
  repository instructions or GitLab project settings.
- The `--template` flag on `glab issue create` loads local repository
  templates; if only a project, group, or instance default template is
  available, use the web or interactive flow, or manually follow the visible
  template structure.

Merge request templates:

- Prefer matching templates in `.gitlab/merge_request_templates/`.
- Do not combine `glab mr create --related-issue` with `--template`; current
  `glab` versions treat those flags as mutually exclusive.
- When creating a related draft merge request early, create it without a merge
  request template. Use the template later when updating the merge request
  description after implementation.
- Also respect project-level default merge request templates when they are
  visible in repository instructions or GitLab project settings.
- The `--template` flag on `glab mr create` loads local repository templates;
  if only a project, group, or instance default template is available, use the
  web or interactive flow for description updates, or manually follow the
  visible template structure.

## Required Sequence

1. Inspect repository instructions such as `AGENTS.md`, `README.md`, `.gitlab`
   templates, branch rules, and existing workflow conventions.
2. Inspect the current branch and worktree:

   ```bash
   git status --short --branch
   ```

3. If the task is too large for one focused merge request, propose a split
   before creating GitLab artifacts.
4. Draft the GitLab issue title and description.
   - Use a semantic English title unless the language rule above calls for
     another language.
   - Use the applicable issue template when one exists.
   - Fill the template's required sections before adding generic context such
     as goal, scope, acceptance criteria, and validation notes.
   - Show the draft issue content to the user and wait for approval before
     creating the issue, unless the user explicitly asked to skip review.
5. Create the approved GitLab issue with `glab issue create`.
6. Create a linked draft merge request immediately from the issue:

   ```bash
   glab mr create \
     --related-issue <issue-iid> \
     --draft \
     --title "<approved-issue-title>" \
     --description "" \
     --yes
   ```

   - Do not pass `--template` with `--related-issue`.
   - Do not pass `--fill`; early related merge requests are created before
     implementation commits exist, and `--fill` is commit-driven.
   - Do not create the source branch locally first.
   - Do not pass `--source-branch` unless the project explicitly requires a
     custom branch name.
   - Pass `--description ""` only to satisfy non-interactive `glab` input
     requirements. Do not add a custom merge request description during early
     creation; let `--related-issue` populate the initial related-issue content,
     then update the merge request description after implementation when useful.
   - Use the approved issue title for `--title`; `--yes` skips submission
     confirmation, but it does not replace the required non-interactive title
     and description inputs.
   - `glab` creates the related source branch from the issue, creates a draft
     merge request, and appends `Closes #<issue-iid>` to the merge request
     description.
   - Record the merge request URL or IID from the `glab mr create` output.
7. Inspect the created merge request to find the source branch, then fetch and
   check out that branch locally:

   ```bash
   glab mr view <merge-request-iid> --output json
   git fetch origin <source-branch>
   git switch --track origin/<source-branch>
   ```

   Use the `source_branch` field from the JSON output as `<source-branch>`.
   If a local branch already exists, use `git switch <source-branch>` instead.
8. Implement the requested change only on the related merge request branch.
9. Run relevant checks before committing.
10. Commit with a semantic English commit message unless the language rule above
    calls for another language.
11. Before pushing or requesting review, draft an updated merge request
    description when useful.
    - Use the matching merge request template as structure.
    - Combine the template with issue context, actual branch diffs or commits,
      and validation results.
    - Avoid duplicating `Closes #<issue-iid>` because `--related-issue`
      already adds it.
    - Show the draft merge request description to the user and wait for approval
      before updating the merge request, unless the user explicitly asked to
      skip review.
12. Update the merge request description after approval.
13. Push the branch.
14. Inspect pipeline status and merge request discussions.
15. Address review feedback in focused follow-up commits or amended commits,
    according to the repository's preferred history style.
16. Wait for pipelines and review to complete before merging.

## Review Feedback Loop

When review comments or pipeline failures appear:

1. Read the merge request pipeline status, review comments, and unresolved
   discussions.
2. Separate actionable feedback from informational comments.
3. Apply only the requested, scoped fixes.
4. Re-run the relevant checks.
5. Commit or amend as appropriate, then push.
6. Summarize what feedback was addressed and what remains open.

Do not resolve discussions, approve, merge, or delete branches unless the user
explicitly asks.

## Existing Local Work

If the user asks to commit, push, publish, or create a merge request for
existing local changes:

1. Inspect the current branch and worktree:

   ```bash
   git status --short --branch
   ```

2. Check whether the current branch already has a merge request:

   ```bash
   glab mr view
   ```

3. Preserve unrelated user changes, and later stage only files that belong to
   the current task.
4. If a matching merge request exists, reuse it.
5. If no merge request exists, create or identify the matching issue, then
   create the related draft merge request before publishing the work.
6. If the current branch is not the related merge request source branch, do not
   commit directly. Check out the GitLab-created source branch and move the
   scoped work there before committing.
7. Validate the scoped changes, commit with a semantic English commit message
   unless the language rule above calls for another language, draft the merge
   request description when useful, get user approval before updating it, then
   push the related source branch.

## Useful Commands

Create an issue from a template:

```bash
glab issue create --title "<type>: <short imperative summary>" \
  --template <template-name> \
  --yes
```

Create an early draft merge request and related branch:

```bash
glab mr create \
  --related-issue <issue-iid> \
  --draft \
  --title "<approved-issue-title>" \
  --description "" \
  --yes
```

Inspect the merge request and check out the related branch:

```bash
glab mr view <merge-request-iid> --output json
git fetch origin <source-branch>
git switch --track origin/<source-branch>
```

Use the `source_branch` field from the JSON output as `<source-branch>`.

Update the merge request description after implementation:

```bash
glab mr update <merge-request-iid> --description "<updated-markdown-body>"
```

Push the branch:

```bash
git push -u origin <source-branch>
```

Inspect pipeline status:

```bash
glab ci status
```

Inspect merge request details:

```bash
glab mr view
```

Inspect unresolved discussions:

```bash
glab mr view --unresolved
```

If the installed `glab` version does not support `--unresolved`, use:

```bash
glab mr view --comments
```

## Failure Handling

- If `glab auth status` fails, ask the user to authenticate before creating or
  editing GitLab artifacts.
- If network or Git transport fails, retry once. If a local proxy is required,
  use the proxy settings provided by the user.
- If the current worktree has unrelated changes, preserve them and do not stage
  or commit them unless the user explicitly asks.
- If the current branch is the default branch, create or identify an issue,
  create the related draft merge request, and check out its source branch
  before editing files.
- If a merge request already exists for the current branch and matches the task,
  reuse it instead of creating a duplicate.
