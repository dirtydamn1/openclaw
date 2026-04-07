# GEMINI.md - OpenClaw Project Context

## Project Overview
OpenClaw 是一个多渠道个人 AI 助手网关，旨在将 Gemini 等 AI 能力集成到各种消息平台（如 WhatsApp, Telegram, Slack, Discord 等）。

### Core Architecture
- **Gateway (Control Plane):** 处理消息路由、身份验证和协议转换。
- **Agent (Runtime):** 负责 AI 推理和任务执行。
- **CLI:** 统一的命令行界面，用于管理、配置和运行 OpenClaw。
- **UI:** 基于 Web 的控制中心。
- **Plugin SDK:** 提供扩展能力，允许第三方集成新的消息渠道或 AI 服务。

### Technology Stack
- **Runtime:** Node.js (22.14+), Bun (用于脚本和开发)
- **Language:** TypeScript (ESM)
- **Monorepo Management:** pnpm
- **Testing:** Vitest
- **Linting/Formatting:** Oxlint, Oxfmt
- **Key Libraries:** Zod (Schema), Commander (CLI), Express/Hono (Server), Playwright (Browser automation)

## Building and Running

### Key Commands
- **Install Dependencies:** `pnpm install`
- **Build Project:** `pnpm build`
- **Run in Development Mode:** `pnpm dev`
- **Start Gateway (Watch):** `pnpm gateway:watch`
- **Run Tests:** `pnpm test` (单元测试), `pnpm test:e2e` (端到端测试)
- **Lint and Check:** `pnpm check` (运行 lint, format 和类型检查)
- **CLI Access:** `pnpm openclaw <command>` 或 `node openclaw.mjs <command>`

### Environment Configuration
- 配置文件通常位于 `~/.openclaw/` 目录下。
- 支持使用 `.env` 文件进行环境变量配置。

## Development Conventions

### General Rules
- **Language:** 使用 **American English** 编写代码、注释、文档和 UI 字符串。
- **File Paths:** 聊天回复中的文件引用必须相对于项目根目录（例如：`src/telegram/index.ts:80`）。
- **Code Style:** 严格遵循 Oxlint 和 Oxfmt 的规范。禁止使用 `any`，优先使用严格类型。
- **Comments:** 对非直观的逻辑进行简明扼要的注释。
- **Safety:** 严禁提交或打印敏感凭据、API 密钥或真实的个人信息。

### Module Organization
- **Core Source:** `src/`
- **Tests:** 与源码同目录放置（`*.test.ts`）。
- **UI:** `ui/`
- **Extensions/Plugins:** `extensions/` 和 `packages/` 目录下。
- **Plugin Boundaries:** 扩展插件必须通过 `openclaw/plugin-sdk/*` 访问核心功能，严禁直接从插件导入 `src/**` 下的内部代码。

### Git Workflow
- **Commit Messages:** 保持简洁且面向行动（例如：`CLI: add verbose flag`）。
- **Branching:** 在 `main` 分支上操作时，必须先 rebase 远程更改，禁止提交 merge commits。
- **Verification:** 提交前应运行 `pnpm check` 以确保代码符合规范。

### Prompt Stability
- 组装模型或工具 Payload 时必须确保排序确定性，以维持 Prompt 缓存的稳定性。
- 优先保留历史字节，避免在每次迭代中重写旧内容。

## Key Files
- `package.json`: 项目依赖和全局脚本。
- `pnpm-workspace.yaml`: Monorepo 成员定义。
- `README.md`: 用户指南和快速开始。
- `AGENTS.md`: 核心开发和架构边界指南（**必读**）。
- `openclaw.mjs`: CLI 入口脚本。
- `src/plugin-sdk/`: 面向插件开发者的公共接口。
- `src/gateway/`: 控制平面实现逻辑。
- `src/agents/`: 代理运行时实现逻辑。
