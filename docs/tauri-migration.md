# OnPeople 0.30.0 最终重构计划与验收基线

本文是最终切换版本的实施基线，不定义灰度版、过渡版或生产双栈。所有工作必须在同一条分支完成，只有下面的验收全部通过后才允许发布 0.30.0。

## 1. 目标架构

```text
React 19 / Vite 8
        │ desktopClient（typed invoke + typed events）
        ▼
Tauri 2.11 desktop-shell
        ├── core-runtime ── Codex App Server sidecar
        ├── storage ─────── SQLite WAL + OS Keychain
        ├── workspace ───── Git + PTY + worktree
        ├── browser-host ── CEF 151.2.0+151.3.14
        ├── mcp-host ────── 5 个一方 MCP server
        ├── onpeople-cli ── 无头任务执行与 JSONL 自动化接口
        └── integrations ── Cloud / Live / model / sidecar
```

前端只读取 Zustand 内存快照和瞬态事件，不使用 localStorage、IndexedDB 或隐式全局桥接。UI 布局和交互保持现有产品行为，不在框架切换中做视觉重设计。

## 2. 命令与事件契约

crates/onpeople-types 是唯一契约源：

- 162 个最终桌面命令逐一映射为 Tauri command；
- 17 个最终订阅逐一映射为 Tauri event；
- 请求、响应、错误、流、窗口标签和线程 ID 全部使用 Rust/TypeScript 生成类型；
- desktopClient.ts 负责序列化、错误归一化、订阅清理和插件 API；
- 未识别命令必须返回结构化错误，不能返回静态成功值。

验收：cargo run -p xtask -- audit、npm run bindings:check、Vitest command/event contract test。

## 3. 桌面能力

src-tauri 负责主窗口、任务窗口、托盘、单实例、onpeople:// 深链接、窗口状态、通知、剪贴板、对话框和 updater。capability 只开放已使用的 command/event/plugin 权限，不开放通用 shell 或任意文件系统权限。

退出流程必须按“停止 App Server → 停止 CEF → 等待子进程 → 保存窗口状态”执行；二次启动把 argv/cwd 转成深链接或任务事件并聚焦已有窗口。

## 4. 数据与升级

数据根目录固定为 internal-agent-workbench。SQLite 开启 WAL、外键和 busy timeout，所有迁移先在临时数据库中执行，再以 journal + 原子替换提交。任何失败都必须回滚并保留诊断。

首次启动支持导入旧 JSON、JSONL、LevelDB、Chromium Profile 和旧版 safeStorage/Windows DPAPI 密文；Provider token、浏览器凭据和云端 token 只进入 OS Keychain/Credential Manager。迁移测试使用临时目录，禁止触碰真实用户数据。

迁移验收覆盖：全新安装、旧版本升级、重复启动、异常中断重启、Keychain 不可用、数据库锁、损坏备份、跨平台路径和 Chromium Profile 保留。

## 5. 浏览器宿主

CEF 以独立 Rust 进程运行，启用 sandbox 和 accelerated OSR。Tauri 壳通过随机 token + 协议版本认证的 UDS（Windows Named Pipe）通信。浏览器宿主必须实现：

- 多 route/tab/history 和原 Profile 隔离；
- navigate/back/forward/reload、点击、填充、按键、滚动、resize、受限 evaluate；
- DOM snapshot、视觉 snapshot、下载/上传、弹窗、新 tab、注释；
- frame/navigation/crash 事件；
- CEF 崩溃后 5 秒内重启并恢复 route/history/Profile；
- 认证失败、越界 URL、危险表达式和跨 route 操作全部拒绝。

验收使用 Playwright + CEF fixture，覆盖 macOS 和 Windows。

## 6. MCP 与文件产物

五个 MCP server 的名字和工具 schema 保持不变。服务通过 Rust stdin JSON-RPC 或内部认证 IPC 启动，不依赖生产 Node。

产物必须是真实格式并可再次打开：

- DOCX：docx-rs
- XLSX：rust_xlsxwriter 写入、calamine 读取验证
- PDF：printpdf 写入、lopdf 读取验证
- PPTX：pptx-rs2
- HTML/site/visualization：严格转义、工作区路径边界保护

图像生成没有配置 gateway 时必须返回明确错误，不能保存假结果。

## 7. 运行时与安全

Codex App Server、Cua Driver 和 CEF 都由 Rust supervisor 启动、监控、停止和重启；sidecar 路径必须来自签名 bundle 或显式绝对路径。工作区、Git、PTY、下载和上传操作都经过路径边界和授权检查。

需要通过 secret redaction、命令注入、路径穿越、MCP 越权、IPC token 重放、深链接伪造、更新包签名、CSP 和 capability 审计。

## 8. 测试门禁

```bash
npm run audit
npm run format:check
npm run lint
npm test
npm run build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run test:e2e
npm run tauri:build
```

发布前另行执行临时数据目录迁移、App Server fake、Git/PTY、CEF 多 tab/崩溃恢复、更新回滚、安装卸载保留数据、macOS arm64/x64、Windows x64 NSIS/MSIX 和包体/内存/启动时间门禁。

## 9. 完成定义

只有同时满足以下条件才算完成：

1. package.json、锁文件和生产源码没有旧桌面运行时、旧桥接或 Node 后端依赖；
2. frontend 所有桌面调用都经过 desktopClient；
3. 162/17 契约、生成 bindings、Tauri commands/events 和测试一致；
4. 真实用户数据目录未被改写；
5. 所有测试和构建门禁通过；
6. 发布包只有 Tauri/Rust 生产栈，且 updater、深链接、sidecar、签名和安装渠道可验证。
