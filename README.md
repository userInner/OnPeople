# OnPeople Desktop 0.30.0

OnPeople 0.30.0 的默认生产壳是 Electron 42：React 19 + TypeScript strict + Vite 8 前端，Rust 1.95 核心，SQLite WAL 数据层，以及稳定的 154 方法 Desktop API。Electron 通过 JSONL stdio/Unix Socket 调用 Rust sidecar；内置浏览器页面由主进程 `WebContentsView` 和隔离持久会话承载，React 只管理标签、地址栏与工具状态，普通外部链接仍可交给系统默认浏览器。Tauri 2.11 生产分支永久保留作为回退目标。

## 架构

- `electron-spike`：Electron 主进程、原生 shell adapter、Rust Desktop host bridge，以及打包/验收脚本。
- `src-tauri`：保留的 Tauri 回退壳，提供窗口、托盘、深链接、单实例、更新、通知、剪贴板、对话框和安全能力白名单。
- `crates/core-runtime`：Codex App Server 生命周期、事件流、线程、目标、Provider、终端、Git、计划任务和运行时诊断。
- `crates/storage`：`internal-agent-workbench` 数据目录、SQLite WAL、Keychain/Credential Manager、迁移日志、原子提交和回滚。
- `crates/mcp-host`：四个一方 MCP 服务：`workspace_artifacts`、`image_generation`、`computer_use`、`research_sources`。
- `crates/onpeople-cli`：与桌面端共享 Provider、凭据和 App Server 协议的无头执行入口。
- `frontend/src/lib/desktopClient.ts`：唯一的前端桌面边界；React 组件不直接调用 Electron 或 Tauri API。

固定兼容项：

- 应用标识：`com.userinner.onpeople`
- 深链接：`onpeople://`
- 数据目录：沿用 `internal-agent-workbench`
- 端口、Provider、任务、插件、脚本和工作区行为保持原有产品契约

## 本地开发

```bash
npm ci --legacy-peer-deps
npm run dev                 # 仅启动 Vite
npm start                   # 启动默认 Electron 桌面应用
npm run tauri:dev           # 启动 Tauri 回退壳
```

如需使用本地 sidecar，可设置：

```bash
CODEX_BIN=/absolute/path/to/codex \
CUA_DRIVER_PATH=/absolute/path/to/cua-driver \
ONPEOPLE_MCP_HOST_SOURCE=/absolute/path/to/onpeople-mcp-host \
ONPEOPLE_CLI_SOURCE=/absolute/path/to/onpeople \
npm run tauri:dev
```

## 无头执行

源码工作区可直接运行：

```bash
npm run onpeople -- exec --sandbox workspace-write -C /path/to/repo "修复测试并验证"
cat prompt.md | npm run onpeople -- exec --ephemeral --json -C /path/to/repo -
```

正式安装包内的命令位于
`OnPeople.app/Contents/Resources/.embedded-runtime/bin/onpeople`（Windows 为
`.embedded-runtime\\bin\\onpeople.exe`）。命令默认只读、禁止交互式审批并要求 Git
仓库；`--json` 输出 JSONL，`--ephemeral` 隔离会话目录，`-o` 保存最终消息。模型流量
通过 OnPeople 自有 Sub2API，而不是 OpenAI API 认证；CLI 优先读取
`ONPEOPLE_SUB2API_KEY`，否则复用桌面端登录后同步到系统凭据库的 Sub2API Key。
`ONPEOPLE_API_KEY` 继续作为兼容别名。为防止 CI 被系统钥匙串授权窗口静默阻塞，
`--ephemeral` 模式默认不读取桌面凭据；确需读取时必须显式添加
`--use-desktop-credentials`。无头模式会复用隔离的缓存目录、固定开发指令前缀，并按
Sub2API 地址与工作区生成不可逆的稳定会话亲和键；键值不包含原始目录名，用于让同一
工作区的独立任务优先落到相同上游账号。`--idle-timeout` 控制无进展看门狗，触发后会先
请求优雅中断；`--timeout` 仍是整个任务的硬上限。传输层默认使用
`--transport auto`：优先 Responses WebSocket，并保留运行时的 HTTPS 回退；
`--transport websocket` 和 `--transport http` 用于强制 A/B 或故障诊断。JSONL 的
`run.completed.transport` 会报告 WS 预热失败、流重试、HTTP 回退和
`previous_response_not_found`，便于把任务质量问题与传输问题分开统计。

## 验收与发布

```bash
npm run audit
npm run check
npm run eval:list
npm run runtime:stage -- --platform darwin --arch arm64
npm run package:contents
npm run electron:package   # 默认 Electron arm64 dir + zip
npm run electron:measure   # 打包产物内存/稳定性验收
npm run tauri:build        # Tauri 回退包
```

`npm run check` 包含 Rust/TypeScript 单元测试、静态检查、构建以及桌面/移动
viewport 的 Playwright 回归。`npm run eval` 运行隔离仓库任务与隐藏行为校验，支持在
相同用例上比较 OnPeople 和 Codex；适配器协议及凭据边界见
[`evals/README.md`](evals/README.md)。

`npm run audit` 会验证 161 个生产命令、13 个订阅、生产桥接边界、旧运行时路径和依赖残留。旧版的 5 个 Pet 命令及其订阅已按产品要求从最终版本移除。发布机还必须提供 Codex、Cua Driver、MCP host 和 OnPeople 无头命令的目标平台签名 sidecar，并设置 Tauri updater 签名密钥；密钥不得提交到仓库。缺少任一 sidecar 时，`runtime:stage` 必须失败，不能生成半成品生产包。

正式安装包的 smoke 会启动 Codex App Server，验证 initialize 握手、无头命令启动以及干净关闭；任一 sidecar 只存在但不能运行时，发布门禁必须失败。

发布矩阵：

- macOS：arm64、x64，DMG + ZIP
- Windows：x64，NSIS + MSIX
- 更新元数据：兼容现有渠道的 `latest.yml`，同时提供 Tauri updater endpoint

### 在 macOS 打包 Windows x64

Windows 包可以直接在 macOS 上交叉构建，不需要虚拟机。Codex 和 Cua Driver 使用对应版本的官方 Windows 二进制；脚本校验下载内容、用 `cargo-xwin` 编译 Rust/Tauri 程序，并生成 NSIS 与 MSIX。

首次准备工具链：

```bash
brew install llvm lld nsis osslsigncode cmake ninja
cargo install --locked cargo-xwin

git clone https://github.com/microsoft/msix-packaging.git \
  "$HOME/Library/Caches/OnPeople/msix-packaging"
cd "$HOME/Library/Caches/OnPeople/msix-packaging"
./makemac.sh --pack --skip-samples --skip-tests -arch arm64
```

生成本地无签名测试包：

```bash
npm run package:win:cross
```

正式签名包还需要 Windows 代码签名 PFX；MSIX Publisher 必须与证书 Subject 完全一致：

```bash
ONPEOPLE_WINDOWS_CERTIFICATE=/absolute/path/onpeople.pfx \
ONPEOPLE_WINDOWS_CERTIFICATE_PASSWORD='...' \
ONPEOPLE_MSIX_PUBLISHER='CN=certificate-subject' \
TAURI_SIGNING_PRIVATE_KEY='...' \
npm run package:win:cross
```

输出位于 `target/x86_64-pc-windows-msvc/release/bundle/`。脚本完成前会检查主程序、MCP Host 与 OnPeople CLI 的 PE 架构，并解包 MSIX 确认 runtime manifest 和必需 sidecar 都已包含。

迁移测试只允许使用临时目录。不得对真实用户目录 `~/Library/Application Support/internal-agent-workbench` 或 Windows 对应目录做清理、覆盖或重建。
