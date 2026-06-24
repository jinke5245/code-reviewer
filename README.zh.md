# Code Reviewer

[English](README.md)

Code Reviewer 是一个早期阶段的 AI 辅助代码审查 CLI。它的目标是在保持核心
审查引擎可跨代码托管平台复用的同时，提供接近 GitHub Copilot Code Review
的审查体验。

当前实现支持 GitLab 合并请求审查和 GitHub 拉取请求审查。更多平台适配器和
由 skill 定义的自定义工具是后续计划。

## Agent 快速开始

当你希望编码 agent 为某个仓库接入 Code Reviewer 时，可以复制下面的提示：

```text
Configure Code Reviewer for this repository.
Use the setup instructions from:
https://gitlab.com/jinke5245/code-reviewer/-/blob/main/README.zh.md
```

Code Reviewer 会在拉取请求或合并请求流水线中运行，读取当前审查目标的元数据
和 diff，调用 OpenAI 兼容模型审查变更，然后把审查结果发布回代码托管平台。

通常需要准备三部分：

- `.codereviewer.yml`：Code Reviewer 配置。
- `.gitlab-ci.yml` 或 `.github/workflows/code-review.yml`：审查任务。
- CI 变量或 secrets：`OPENAI_API_KEY`、`OPENAI_MODEL` 和平台 token。私有模型
  网关还需要 `OPENAI_BASE_URL`。

## 第 1 步：创建 `.codereviewer.yml`

在仓库根目录创建 `.codereviewer.yml`，并写入下面的关键字段。默认的
`provider: auto` 会自动检测 GitLab 合并请求 CI 或 GitHub Actions 拉取请求运行。

GitLab 示例：

```yaml
# yaml-language-server: $schema=https://gitlab.com/jinke5245/code-reviewer/-/raw/main/.schemas/code-reviewer.schema.json
gitlab:
  publish: inline
review:
  maxRounds: 12
prompts:
  extraRules:
    - 用中文撰写审查摘要、问题和修改建议。
    - 评论保持简洁，并聚焦可操作的问题。
    - >-
      当某个问题存在能安全替换所选 diff 范围的直接修复时，填充
      replacementCode，并提供完整替换代码，这样 GitLab 可以渲染可应用的
      suggestion 块。
    - >-
      优先读取有针对性的上下文，避免大范围扫文件；一旦问题已有充分依据，
      就停止继续收集上下文。
tools:
  limits:
    maxToolCalls: 120
```

GitHub 示例：

```yaml
# yaml-language-server: $schema=https://gitlab.com/jinke5245/code-reviewer/-/raw/main/.schemas/code-reviewer.schema.json
github:
  publish: inline
review:
  maxRounds: 12
prompts:
  extraRules:
    - 用中文撰写审查摘要、问题和修改建议。
    - 评论保持简洁，并聚焦可操作的问题。
tools:
  limits:
    maxToolCalls: 120
```

配置来源会按下面的顺序查找：

1. 显式传入的 `--config <path>`。
2. `.codereviewer.yml`。
3. `.codereviewer.yaml`。
4. `.codereviewer.json`。
5. `.codereviewer.jsonc`。
6. `package.json#codereviewer`。
7. `pyproject.toml#[tool.codereviewer]`。
8. `Cargo.toml#[package.metadata.codereviewer]`。
9. 内置默认值。

首次接入时建议使用 `.codereviewer.yml`。不要把 API key、GitLab token、
GitHub token 或其他 secrets 写进配置文件。

## 第 2 步：配置 CI Secrets

在目标 GitLab 项目或 GitHub 仓库中配置这些变量：

- `OPENAI_API_KEY`：OpenAI 兼容模型端点的 API key。
- `OPENAI_MODEL`：审查使用的模型名称。
- `OPENAI_BASE_URL`：可选的私有模型网关 URL。
- `GITLAB_TOKEN` 或 `GL_TOKEN`：用于读取合并请求上下文、diff、讨论，并发布
  审查备注的 token。
- `GITHUB_TOKEN`：GitHub Actions 会提供 `secrets.GITHUB_TOKEN`；把它传给
  审查步骤的环境变量。如果使用自定义 token，请将 `github.tokenEnv` 设置为
  对应的环境变量名。

Code Reviewer 会先读取 `GITLAB_TOKEN`，再回退到 `GL_TOKEN`。

## 第 3 步：添加审查任务

### GitLab CI

在 `.gitlab-ci.yml` 中添加审查任务。推荐使用手动审查任务，因为 AI 审查通常
更适合按需运行，而不是每次临时 push 都运行。

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

如果项目已有 `stages`，只在缺少 `review` 时添加它。如果团队希望每个合并请求
流水线都自动运行 AI 审查，可以移除 `when: manual`。

### GitHub Actions

添加 `.github/workflows/code-review.yml`。内置 `GITHUB_TOKEN` 需要读取内容和
写入拉取请求评论的权限。

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  issues: write
  pull-requests: write

jobs:
  ai-code-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install -g @jinke5245/code-reviewer
      - run: codereviewer --version
      - run: codereviewer review
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          OPENAI_MODEL: ${{ vars.OPENAI_MODEL }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

对于接收不受信任 fork 拉取请求的公开仓库，请保持模型 secrets 不暴露给 fork
PR 运行，或从受信任的 workflow 触发审查。

## 第 4 步：验证首次审查

从合并请求流水线或拉取请求 workflow 触发 `ai-code-review`。成功接入后应看到：

- `codereviewer --version` 输出已安装版本。
- 任务日志显示审查进度和最终 JSON。
- 当 `gitlab.publish: inline` 时，MR 会收到一条摘要备注，并为能映射到精确
  diff 行的问题创建行内讨论。
- 当 `github.publish: inline` 时，PR 会收到一条摘要 issue 评论，并为能映射到
  精确 diff 行的问题创建行内 review comments。

调试时运行：

```sh
codereviewer review --dry-run --verbose
```

Verbose 日志会写入 stderr，包含配置、MR 上下文、prompt 字节数、模型轮次、
工具调用摘要和工具结果大小。最终 review JSON 仍会写入 stdout，方便 CI 步骤
解析。

## 配置参考

完整字段、默认值、发现规则、模板、工具、权限和模型响应格式行为，请查看
[配置](docs/configuration.zh.md)。首次接入时先使用上面的最小
`.codereviewer.yml`，只有在需要调优模型设置、发布模式、prompts、模板或工具
限制时再查看参考文档。

## 故障排查

- `codereviewer --version` 没有输出：确认包已成功安装，并且任务使用受支持的
  Node.js 版本。
- 缺少 `CI_MERGE_REQUEST_IID`：任务没有运行在合并请求流水线中；检查 `rules`。
- 缺少 GitLab token：配置 `GITLAB_TOKEN` 或 `GL_TOKEN`。
- 缺少 GitHub token：确认 workflow 暴露了 `GITHUB_TOKEN`，或将
  `github.tokenEnv` 设置为自定义 token 环境变量。
- Provider 检测不明确：在 `.codereviewer.yml` 中设置 `provider: gitlab` 或
  `provider: github`。
- 缺少模型名称：配置 `OPENAI_MODEL`，或在配置文件中设置 `model.model`。
- 模型网关拒绝结构化响应格式：保持 `model.responseFormat: auto`，它会从
  `json_schema` 回退到 `json_object`，再回退到只依赖 prompt 的 JSON 输出。
- Inline 模式成功但没有行级线程：先检查 MR 摘要备注。只有能锚定到精确 diff
  行的问题才会变成行内讨论。
- 不清楚审查路径：运行 `codereviewer review --dry-run --verbose`。Verbose 日志
  不会包含完整 prompts、原始模型响应或原始工具结果。

## 开发

使用 pnpm 安装依赖：

```sh
pnpm install
```

运行检查：

```sh
pnpm check
```

实时 OpenAI 兼容集成测试默认跳过。如需运行，请提供模型环境变量并显式启用：

```sh
RUN_LIVE_OPENAI_TESTS=true pnpm test tests/integration/openai-compatible-live.test.ts
```

本地命令、测试、构建和打包说明请查看[开发文档](docs/development.zh.md)。
