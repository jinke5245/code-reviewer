# 开发

[English](development.md)

本项目使用 Node.js、pnpm、TypeScript、Vitest、ESLint、Prettier 和 Husky。

安装依赖：

```sh
pnpm install
```

开发时运行 CLI：

```sh
pnpm dev
```

运行完整本地检查：

```sh
pnpm check
```

运行单项检查：

```sh
pnpm typecheck
pnpm lint
pnpm test
```

实时 OpenAI 兼容集成测试默认跳过。如需使用已配置的模型端点运行，请显式启用：

```sh
RUN_LIVE_OPENAI_TESTS=true pnpm test tests/integration/openai-compatible-live.test.ts
```

测试布局：

- `tests/unit`：隔离的模块和 CLI 行为测试。
- `tests/integration`：GitLab、模型和端到端审查流程测试。

构建 TypeScript 输出：

```sh
pnpm build
```

打包可执行 CLI：

```sh
pnpm bundle
```
