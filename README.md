# Code Reviewer

Code Reviewer is an early-stage AI-assisted code review CLI. It aims to provide
a review experience similar to GitHub Copilot Code Review while keeping the core
review engine portable across code hosting platforms.

The current implementation supports GitLab merge request review. GitHub support,
platform adapters, and skill-defined custom tools are planned follow-up
milestones.

## Agent Quick Start

Copy this prompt to your coding agent when you want it to wire Code Reviewer
into a repository:

```text
Configure Code Reviewer for this repository.
Use the setup instructions from:
https://gitlab.com/jinke5245/code-reviewer/-/blob/main/README.md
```

Code Reviewer runs in a merge request pipeline, reads the current MR metadata and
diff, asks an OpenAI-compatible model to review the change, and publishes the
review back to the merge request.

The setup usually needs three pieces:

- `.codereviewer.yml`: Code Reviewer configuration.
- `.gitlab-ci.yml`: a review job, usually triggered manually.
- GitLab CI/CD variables: `OPENAI_API_KEY`, `OPENAI_MODEL`, and `GITLAB_TOKEN`
  or `GL_TOKEN`; private model gateways also need `OPENAI_BASE_URL`.

## Step 1: Create `.codereviewer.yml`

Create `.codereviewer.yml` at the repository root with the key fields below:

```yaml
# yaml-language-server: $schema=https://gitlab.com/jinke5245/code-reviewer/-/raw/main/.schemas/code-reviewer.schema.json
gitlab:
  publish: inline
review:
  maxRounds: 12
prompts:
  extraRules:
    - Write review summaries, findings, and suggestions in Chinese.
    - Keep comments concise and focused on actionable issues.
    - >-
      When a finding has a safe direct replacement anchored to the selected diff
      range, populate replacementCode with the complete replacement code so
      GitLab can render an applyable suggestion block.
    - >-
      Prefer targeted reads over broad file sweeps; stop gathering context once
      findings are supported.
tools:
  limits:
    maxToolCalls: 120
```

Configuration sources are checked in this order:

1. The explicit `--config <path>` value.
2. `.codereviewer.yml`.
3. `.codereviewer.yaml`.
4. `.codereviewer.json`.
5. `.codereviewer.jsonc`.
6. `package.json#codereviewer`.
7. `pyproject.toml#[tool.codereviewer]`.
8. `Cargo.toml#[package.metadata.codereviewer]`.
9. Built-in defaults.

Prefer `.codereviewer.yml` for first-time setup. Do not store API keys, GitLab
tokens, or other secrets in configuration files.

## Step 2: Configure GitLab CI/CD Variables

Configure these variables in the target GitLab project:

- `OPENAI_API_KEY`: API key for the OpenAI-compatible model endpoint.
- `OPENAI_MODEL`: model name used for review.
- `OPENAI_BASE_URL`: optional private model gateway URL.
- `GITLAB_TOKEN` or `GL_TOKEN`: token used to read merge request context,
  diffs, discussions, and publish review notes.

Code Reviewer reads `GITLAB_TOKEN` first and falls back to `GL_TOKEN`.

## Step 3: Add a GitLab Review Job

Add a review job to `.gitlab-ci.yml`. Manual review jobs are recommended because
AI review is often most useful on demand, not on every temporary push.

```yaml
stages:
  - review

ai-code-review:
  image: node:22-bookworm-slim
  stage: review
  before_script:
    - npm install -g @jinke5245/code-reviewer
  script:
    - codereviewer --version
    - codereviewer review
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      when: manual
      allow_failure: true
    - when: never
```

If the project already has `stages`, only add `review` if it is missing. Remove
`when: manual` if the team wants every merge request pipeline to run AI review
automatically.

## Step 4: Verify the First Review

Trigger `ai-code-review` from a merge request pipeline. A successful setup should
show:

- `codereviewer --version` prints the installed version.
- The job log shows review progress and final JSON.
- With `gitlab.publish: inline`, the MR receives one summary note and inline
  discussions for findings that can be mapped to exact diff lines.

For debugging, run:

```sh
codereviewer review --dry-run --verbose
```

Verbose logs go to stderr and include configuration, MR context, prompt byte
counts, model rounds, tool call summaries, and tool result sizes. The final
review JSON still goes to stdout so CI steps can parse it.

## Configuration Reference

See [Configuration](docs/configuration.md) for all fields, defaults, discovery
rules, templates, tools, permissions, and model response format behavior. Start
with the minimal `.codereviewer.yml` above, then use the reference only when you
need to tune model settings, publish mode, prompts, templates, or tool limits.

## Troubleshooting

- `codereviewer --version` prints nothing: confirm the package installed
  successfully and the job uses a supported Node.js version.
- `CI_MERGE_REQUEST_IID` is missing: the job is not running in a merge request
  pipeline; check the `rules`.
- GitLab token is missing: configure `GITLAB_TOKEN` or `GL_TOKEN`.
- Model name is missing: configure `OPENAI_MODEL` or set `model.model` in the
  config file.
- The model gateway rejects structured response formats: keep
  `model.responseFormat: auto`, which falls back from `json_schema` to
  `json_object` to prompt-only JSON output.
- Inline mode succeeds but no line-level threads appear: check the MR summary
  note first. Only findings anchored to exact diff lines become inline
  discussions.
- The review path is unclear: run `codereviewer review --dry-run --verbose`.
  Verbose logs do not include full prompts, raw model responses, or raw tool
  results.

## Development

Install dependencies with pnpm:

```sh
pnpm install
```

Run checks:

```sh
pnpm check
```

Live OpenAI-compatible integration tests are skipped by default. To run them,
provide model environment variables and opt in:

```sh
RUN_LIVE_OPENAI_TESTS=true pnpm test tests/integration/openai-compatible-live.test.ts
```

See [Development](docs/development.md) for local commands, tests, build, and
packaging notes.
