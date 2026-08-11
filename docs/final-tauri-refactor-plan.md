# OnPeople 0.30.0 最终态重构计划（历史回退方案）

> 本文记录早期的 Tauri-only 方案。当前生产壳已切换为 Electron +
> WebContentsView；保留本文作为 `tauri-production` 的永久回退参考。当前验收
> 结果见 `electron-spike/RESULTS.md`。

## 1. 目标与不可变约束

本次重构的交付物只有一个可发布目标：`OnPeople 0.30.0`。生产环境不发布 Electron 过渡版、不发布 Tauri 双栈版、不保留 Node 主进程兼容层。

固定约束如下：

- 桌面壳：Tauri 2.11，Rust 1.95，应用标识 `com.userinner.onpeople`。
- 前端：React 19、TypeScript strict、Vite 8；UI 行为与现有工作台保持一致，不借重构做视觉重设计。
- 数据：保留 `internal-agent-workbench` 数据目录；SQLite WAL 为唯一业务数据库；凭据只进 macOS Keychain / Windows Credential Manager。
- 协议：保留 `onpeople://`；最终的 162 个能力名与 17 个事件名进入 typed command/event contract，前端只通过 `desktopClient` 调用。
- 浏览器：独立 Rust CEF browser-host，CEF `151.2.0+151.3.14`，通过随机 token + 协议版本认证的 Unix domain socket / Windows Named Pipe 通信。
- 运行时：Codex App Server、Cua Driver、CEF browser-host、MCP host 均为独立 Rust sidecar；Tauri shell 只负责生命周期、权限、窗口与 IPC 编排。
- 发布：macOS arm64/x64 DMG + ZIP/updater archive；Windows x64 NSIS + MSIX；更新器使用 Tauri updater 签名，旧 `latest.yml` 的 CDN 路径由发布服务转换为 Tauri updater JSON，客户端不再解析 Electron feed。

## 2. 最终目录与职责

```text
frontend/                  React 工作台、Zustand、xterm、Markdown/PDF 视图
src-tauri/                 Tauri desktop-shell、窗口、托盘、插件、命令注册
crates/onpeople-types/     Rust/TypeScript 共用 DTO、错误码、命令/事件契约
crates/core-runtime/       App Server client、agent 状态、thread/goal/scheduler
crates/storage/            SQLite、迁移、Keychain、旧数据导入、原子提交
crates/workspace/          文件边界、Git、PTY、worktree、项目动作
crates/browser-host/       CEF、OSR、浏览器 IPC、Profile、DOM/视觉数据
crates/mcp-host/           五个稳定 MCP server 名称与 artifact 生成
crates/onpeople-cli/       无头任务执行、JSONL 输出和 CI/评测入口
crates/integrations/       Cloud、Live、model gateway、sidecar path resolver
xtask/                     bindings、审计、迁移/发布 staging 与签名编排
```

边界规则：

1. React 不直接 import 任意 Tauri API；所有 native 能力集中在 `frontend/src/lib/desktopClient.ts`。
2. Rust domain service 不读取 WebView 状态；所有跨进程数据都经过 DTO、错误码和事件 envelope。
3. `src-tauri` 不包含业务数据库 SQL、浏览器 DOM 逻辑或 artifact 格式实现。
4. 所有路径先经过 workspace boundary；所有 sidecar 路径只允许来自签名/打包目录或显式测试覆盖路径。

## 3. 执行顺序

### 3.1 契约冻结

- 从旧 preload 提取并冻结 162 个方法、17 个事件、参数默认值、错误语义和流式行为。
- 在 `onpeople-types` 定义 DTO、`AppError`、`ErrorCode`、`EventEnvelope`、`StreamEnvelope`。
- 用 `ts-rs` 导出 TypeScript bindings；`xtask bindings --check` 阻止手工漂移。
- 以命令名、事件名、序列化 camelCase、错误码作为兼容边界；不再兼容 `window.workbench`、`workbench_invoke` 或任意 preload 对象。

### 3.2 数据迁移一次性完成

迁移只对临时副本或用户启动时的正式迁移事务执行，绝不直接改写真实用户数据做测试。

1. 解析并锁定旧目录：`~/Library/Application Support/internal-agent-workbench` 或 Windows 对应应用数据目录。
2. 创建同目录下版本化 migration journal 与临时 SQLite 文件。
3. 导入 JSON、JSONL、LevelDB、Chromium `Partitions/internal-agent-browser` Profile；缓存、lock、编译产物与临时文件跳过，原 Profile 保留。
4. 旧 safe-storage / DPAPI 密文只在本机系统密钥能力可用时解密；解密后的秘密写入 OS Keychain/Credential Manager，SQLite 只保存 `keychain_ref`。
5. 执行 schema migration、外键校验、数量校验、关键 thread/provider/preferences round-trip 校验。
6. 写入 journal 的 checksum 与迁移版本，执行 SQLite backup/checkpoint，再原子 rename 正式数据库。
7. 任一步骤失败：删除临时 DB、保留 journal、恢复到迁移前状态；成功后旧文件只读保留，供诊断与手工恢复，不作为生产读取源。

验收必须包括：空目录、完整旧目录、损坏 JSON、损坏 LevelDB、缺失 Keychain、重复迁移、磁盘空间不足、进程中断恢复。

### 3.3 Rust domain service

- `core-runtime`：启动/停止 App Server、request timeout、pending request、notification 转 event、thread/goal/provider/scheduler 状态。
- `workspace`：路径边界、列举/搜索、Git diff/stage/unstage/discard/apply/commit/push、PTY resize/write/exit、worktree 生命周期。
- `storage`：WAL、busy timeout、事务、备份、journal、Keychain 引用和数据健康检查。
- `integrations`：Cloud/Live/model gateway 只通过 Rust client，敏感字段统一脱敏，不把 token 写入日志或事件。
- 领域命令统一返回 `Result<T, AppError>`；未知命令返回 `UNSUPPORTED`，禁止返回伪成功对象。

### 3.4 Tauri desktop-shell

- 主窗口和 task window 使用稳定 label；single-instance 将第二次启动的 argv/deep link 转事件并聚焦主窗口。
- 注册 clipboard、dialog、notification、deep-link、single-instance、window-state、updater 插件。
- capabilities 只授予当前窗口所需权限；不启用 global Tauri，不把任意文件系统或 shell 权限暴露给前端。
- 托盘操作只触发 typed event；退出前停止 App Server、PTY 和 browser-host。
- `onpeople://` 在 macOS/Windows 注册，解析 URL 后统一进入 `app:deep-link`。
- updater 配置固定公钥与 HTTPS endpoint；签名私钥只能来自 CI secret，不能进入仓库、bundle 或日志。

### 3.5 独立 CEF browser-host

- CEF 使用 accelerated OSR；macOS 使用 IOSurface，Windows 使用 D3D11 shared texture，软件渲染仅作 GPU 丢失时的恢复路径。
- shell 启动 browser-host 时注入 profile、IPC endpoint、随机 token、协议版本；子进程崩溃后按退避策略重启并发布 crash event。
- accelerated frame 的跨进程句柄不得传 Rust 指针：macOS 发送 `IOSurfaceGetID`，Windows 发送 D3D11 shared-handle 标识；Tauri native compositor 负责在目标进程导入并在 anchor bounds 内呈现。
- browser-host 自己维护 route/tab/history/profile，不向 MCP 或前端泄露 cookie、密码、authorization header、storage value。
- 实现 navigate/back/forward/reload、DOM snapshot、visual snapshot、developer inspect、click/fill/press/scroll/hover/wait、download/upload、popup/new-tab、session clear、Profile import。
- 所有 IPC 请求做长度限制、URL scheme/host 策略、route ownership、超时、取消与 constant-time token 校验。

### 3.6 MCP host 与 artifact

Rust MCP host 保留以下名字，不改变插件配置入口：

- `internal_browser`
- `workspace_artifacts`
- `image_generation`
- `computer_use`
- `research_sources`

artifact 输出必须是真实格式并在写入后读取校验：DOCX 用 `docx-rs`，XLSX 用 `rust_xlsxwriter` + `calamine`，PDF 用 `printpdf`/`lopdf`，PPTX 用 `pptx-rs2`，OOXML 通过 ZIP/XML 校验。图像生成没有可用 gateway 时返回明确错误，不生成确定性占位图片。

### 3.7 React 工作台

- Zustand 只保存内存快照和 UI 状态；不使用 localStorage，不复制 Rust 数据库。
- 初始化一次拉取 agent/preferences/threads/runtime/scheduler/browser 快照，再订阅 runtime、scheduler、terminal、browser、live、deep-link、update 事件。
- Timeline、Composer、Settings、Sidebar、Browser、Files、Git、Terminal、Utility 保持原交互语义；浏览器的 native surface anchor 与 CEF frame 生命周期绑定。
- Markdown 统一 DOMPurify；PDF 使用 pdf.js；终端使用 xterm，输入、resize、exit 全部经 typed client。
- 浏览器地址栏、文件选择、Git mutation、credential 操作必须有显式错误态和 loading 态，不能吞掉失败。

### 3.8 运行时资源供应与 staging

发布构建不得从开发机路径、旧 Electron staging 目录或隐式下载兜底。每一个目标平台/架构先由 CI 产出并签名以下五个最终 sidecar，再执行 staging：

- Codex App Server：`codex` / `codex.exe`
- Cua Driver：`cua-driver` / `cua-driver.exe`
- CEF browser-host：`onpeople-browser-host` / `onpeople-browser-host.exe`
- MCP host：`onpeople-mcp-host` / `onpeople-mcp-host.exe`
- 无头执行：`onpeople` / `onpeople.exe`

staging 只允许通过显式绝对路径变量或当前目标的 `target/release` 产物完成：

```text
CODEX_BUNDLE_SOURCE
CUA_DRIVER_BINARY_SOURCE
ONPEOPLE_BROWSER_HOST_SOURCE
ONPEOPLE_MCP_HOST_SOURCE
```

CI 也可以将五个目标匹配的可执行文件放在 `ONPEOPLE_RUNTIME_DIR`，但该目录必须由受控 runner 预置；仓库不会下载未校验的二进制。缺少 Codex/CUA、签名私钥或目标产物时，`runtime:stage` / `release:gate` 必须失败。

`npm run runtime:stage -- --platform <darwin|win32> --arch <arm64|x64>` 会清理并重建本次构建专用的 `.embedded-runtime`，写入目标平台、组件版本和 SHA-256 manifest；随后必须运行 `npm run package:contents`。五个组件任意缺失、来源不是文件、目标平台不匹配或 checksum 不一致，都必须在 `tauri:build` 前失败。`.embedded-runtime` 不提交仓库，也不承载旧 Electron 资源。

Windows Store 产物不依赖 Tauri CLI 的 bundle target：`xtask package-msix` 在 Windows runner 上用固定 AppxManifest、`makeappx.exe` 和 `signtool.exe` 生成/签名 MSIX；macOS ZIP 由 `xtask package-macos-zip` 用 `ditto --keepParent` 从已签名 `.app` 生成。两条命令均只作用于本次 `target/release/bundle` staging，缺少 publisher、证书或系统打包工具时直接失败。

### 3.9 工作流、输入输出与责任边界

以下工作流可以并行开发，但合并和发布只能按依赖顺序推进。工作流名称是内部工程组织方式，不对应任何用户可见版本或灰度运行时。

| 工作流          | 输入                                     | 必须交付                                                                 | 硬门禁                                              |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------- |
| 契约与前端边界  | 旧 preload/API fixture                   | 162 command、17 event、错误码、生成 bindings、`desktopClient`            | `bindings:check`、映射矩阵 100%                     |
| 数据与凭据      | 临时复制的旧数据目录、脱敏凭据 fixture   | schema、journal、幂等迁移、Keychain/Credential Manager adapter、回滚证据 | 原目录不被测试改写；中断/损坏/重复迁移通过          |
| Rust 运行时     | App Server/Cua 测试 sidecar              | Tokio supervisor、请求取消/超时、事件顺序、PTY/Git/worktree、Cloud/Live  | Rust unit/integration、进程树清理、无 secret 日志   |
| CEF 浏览器      | CEF 固定版本、OS compositor fixture      | accelerated OSR、输入/快照/下载上传/弹窗/Profile、认证 IPC、崩溃恢复     | macOS/Windows 原生 runner 视觉与交互 E2E            |
| MCP 与 artifact | 脱敏插件 fixture、格式校验 fixture       | 五个 MCP server、真实 DOCX/XLSX/PDF/PPTX/OOXML 产物                      | 读取回验、路径边界、缺少 gateway 时明确报错         |
| React 工作台    | 原 renderer 行为 fixture                 | 等价布局、快捷键、错误态、流式状态、Terminal/PDF/Markdown                | Vitest、Testing Library、Playwright 多窗口尺寸      |
| 打包与签名      | 五个目标平台 sidecar、证书、updater 私钥 | DMG/ZIP、NSIS/MSIX、签名、公证、更新 JSON、checksum                      | `package:contents`、`release:gate`、安装/升级 smoke |
| 发布切换        | 全部上述证据                             | 仅 0.30.0 Tauri 渠道、旧 feed 停写、回滚快照                             | 任何一项缺失都不发布、不生成下载链接                |

每个工作流的负责人必须提交“实现、测试、产物、失败日志”四类证据；只提交代码或静态审计结果不能关闭门禁。跨工作流接口以 `onpeople-types`、SQLite migration version、IPC protocol version 和 package manifest 为唯一事实源。

### 3.10 不允许出现的中间态

- 不创建 Electron/Tauri 双写、双读、双窗口或运行时选择器。
- 不保留 `window.workbench`、`workbench_invoke`、preload 兼容层或生产 Node 后端。
- 不用“未实现但返回成功”的 placeholder、静态假数据或隐藏 feature flag 代替真实能力。
- CEF 的软件渲染只允许作为同一 CEF 进程的 GPU 丢失恢复路径；不能作为第二套生产浏览器实现，也不能由用户或远端配置切换。
- 迁移临时库、journal、备份、CI staging 和回滚快照只存在于内部流程，不作为可下载版本、不写入第二个生产数据源。
- 旧 Electron feed 只做一次发布渠道兼容转换；OnPeople 0.30.0 客户端只消费 Tauri updater JSON。

## 4. 测试与质量门槛

提交前必须全部通过：

```text
npm ci --legacy-peer-deps
npm run audit
npm run bindings:check
npm run format:check
npm run lint
npm test
npm run test:e2e
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run build
npm run tauri:build
```

测试矩阵：

- Rust unit：DTO round-trip、SQLite WAL/事务、迁移 journal、Keychain adapter、路径边界、Git、PTY、scheduler、MCP artifact、IPC token。
- Vitest/Testing Library：desktopClient 错误归一化、Zustand 快照、Timeline stream、Settings、Composer、浏览器工具栏、移动端布局。
- Playwright：macOS/Windows 桌面 viewport、移动窄屏、主区/侧栏/工具舱布局、设置覆盖层、终端/文件/Git 错误态。
- CEF E2E：route 隔离、导航、DOM/视觉快照、输入/上传/下载、popup、crash recovery、Profile import、敏感字段不外泄。
- migration E2E：真实旧目录只复制到临时目录后验证，不触碰用户生产目录。
- 安全门槛：`rg` 不得发现 `window.workbench`、`workbench_invoke`、Electron 生产依赖、node-pty、旧 builder 配置或 preload 文件。
- 性能门槛：冷启动、首屏、PTY 输出、Agent delta、CEF frame、SQLite migration、安装包体积均记录基线；超预算阻止发布。
- 包门禁：每个发布矩阵先通过 runtime staging/contents、codesign/notarize 或 Authenticode/MSIX 签名，再运行 `tauri:build`；没有五个已验证 sidecar 或 updater 私钥时，发布任务必须失败，不生成可下载的“半成品包”。
- 产物门禁：macOS 必须同时存在 DMG 与 ZIP；Windows 必须同时存在 NSIS `.exe` 与已签名 `.msix`。发布 gate 不接受只有 Tauri 默认 MSI 或只有 macOS updater archive 的矩阵。

### 4.1 阻断条件与证据规则

以下任一项成立时，状态只能是“不可发布”，不能通过文档、静态 audit 或手工确认覆盖：

- 任一 command/event 只有名称映射，没有真实 handler、真实事件流或明确 `UNSUPPORTED`。
- 迁移测试写入真实 `internal-agent-workbench` 目录，或迁移失败无法证明旧数据保持不变。
- CEF accelerated frame 的句柄生命周期、输入注入、Profile 隔离或崩溃恢复没有在目标操作系统上实测。
- macOS arm64/x64 或 Windows x64 的 sidecar、签名、公证、MSIX/NSIS、安装升级链路缺少目标 runner 证据。
- 包内容含未校验二进制、调试远程端口、秘密、Electron/Node 生产代码或未声明回退路径。
- 只有开发服务器、源码测试或单机成功；没有从干净环境构建并安装验证最终 bundle。

每个门禁结果记录命令、commit、目标平台/架构、输入 manifest、输出 checksum 和失败时的可复现日志。没有证据的项目默认为未通过。

## 5. 最终切换与发布

发布前由 CI 在干净环境执行 sidecar 构建、签名、staging 和 Tauri bundle。所有 sidecar 必须放入最终资源目录并通过 `xtask audit` 检查；本地缺失 sidecar 时构建应明确失败，不以开发机路径兜底。

最终切换窗口只做以下动作：

1. 停止旧版本发布入口与 Electron 更新 feed 写入。
2. 生成同版本 `0.30.0` 的 macOS/Windows Tauri 安装包、updater archive 与签名。
3. 将 CDN 的旧 `latest.yml` 信息转换成 Tauri updater JSON，保留下载地址和历史版本可追溯性。
4. 发布 DMG/ZIP、NSIS/MSIX、更新 JSON、签名文件和校验值。
5. 用全新安装、旧数据升级、深链启动、单实例、更新安装、卸载保留数据六条 smoke path 验证后开放下载。

CI 的实际顺序固定为：`npm ci` → 构建/获取五个 sidecar → `npm run runtime:stage` → `npm run package:contents` → `npm run check` → 签名/公证 → `npm run tauri:build` → 安装/升级 smoke → 发布资产。上述顺序是发布流水线的内部步骤，不构成任何用户可见的中间版本。

不产生任何用户可见的迁移版本；迁移事务、临时文件、CI staging 和回滚副本都属于发布前/启动时内部实现，不是产品形态。

## 6. 完成定义

只有同时满足以下条件才标记完成：

- 仓库中不存在 Electron 主进程、preload、renderer、Node 生产模块或 builder 配置。
- 162 command / 17 event contract 有真实 Rust handler 或明确 `UNSUPPORTED` 错误，不能伪造成功。
- 数据迁移在临时副本上通过，真实数据目录未被测试修改，Keychain 引用可恢复。
- CEF、App Server、Cua、MCP sidecar 都能被最终 bundle 找到并完成 token-authenticated IPC。
- macOS arm64/x64 和 Windows x64 的最终 bundle、签名、更新 JSON、安装/升级 smoke 均通过。
- 上述全部质量门槛通过，且没有为了“通过检查”而加入第二套生产运行时。

## 7. 一次性切换决策

在所有 4.1 阻断条件清零前，继续停留在开发/验证状态，不能对外宣布 0.30.0 已可升级。清零后只执行一次正式切换：冻结旧版本发布、构建并签名全部目标产物、完成迁移/安装/升级 smoke、切换下载与 updater 元数据，然后开放 0.30.0。

切换后不保留 Electron 运行路径、不做用户分批灰度、不维护 Electron/SQLite 双写。若发现阻断问题，回滚对象是发布渠道和切换前快照，不是把 Electron 代码重新放回 0.30.0 包内。
