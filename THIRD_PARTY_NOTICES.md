# Third-party notices

OnPeople Desktop 0.30.1 使用以下开源组件。各组件的完整许可证和版本以 Cargo.lock、package-lock.json 及其上游仓库为准。

- Tauri、Tauri plugins、wry、tao：MIT。
- SQLite/rusqlite、portable-pty、keyring、reqwest、tokio、serde、zip：各自上游许可证。
- docx-rs、rust_xlsxwriter、calamine、printpdf、lopdf、pptx-rs2：各自上游许可证；这些库用于生成或验证真实 DOCX/XLSX/PDF/PPTX 文件。
- React、Vite、Zustand、marked、DOMPurify、xterm.js、pdf.js、Lucide React：各自上游许可证。
- Cua Driver 和 Codex App Server 是独立 sidecar；发布时必须提供与目标平台匹配的版本、来源、签名和 SHA-256 清单。

任何未随仓库发布的云端服务或签名材料均不属于本仓库的分发内容。
