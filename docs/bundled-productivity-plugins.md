# OnPeople bundled productivity plugins

OnPeople bundles seven clean-room productivity plugins:

- `documents`
- `pdf`
- `spreadsheets`
- `presentations`
- `template-creator`
- `sites`
- `visualize`

Each package follows the public `.codex-plugin/plugin.json` layout and contains
OnPeople-owned skill instructions. The packages call the built-in
`workspace_artifacts` MCP server; they do not contain or redistribute Codex
Desktop private source, cached prompts, scripts, assets, or proprietary plugin
runtime files.

At application startup the signed packages are copied from
`.embedded-runtime/plugins/` into OnPeople's isolated `CODEX_HOME`. A package is
reinstalled only when its bundled version changes. The staging task records a
SHA-256 for every plugin file in `manifest.json` and the release content gate
verifies those hashes. Both Tauri bundles and the cross-built Windows MSIX
therefore receive the same packages.

## Verification

Validate a package manifest with the public plugin validator:

```sh
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/documents
```

Run the artifact round-trip tests and the desktop checks:

```sh
cargo test -p onpeople-mcp-host
cargo check -p onpeople-core-runtime -p onpeople-tauri
npm test
```
