# OnPeople Industry Plugin Protocol v1

An industry plugin turns OnPeople Core into a domain-specific agent without modifying the application runtime. It remains a standard Codex plugin and adds one OnPeople companion manifest.

## Package layout

```text
plugin-name/
  .codex-plugin/plugin.json
  .onpeople/industry.json
  instructions/agent.md
  skills/
  templates/
  policies/
  evals/
  .mcp.json
```

`.codex-plugin/plugin.json` owns standard plugin metadata, Skills, Apps, MCP servers, assets, and marketplace compatibility. `.onpeople/industry.json` owns industry activation metadata. OnPeople-specific fields must not be added to the standard manifest.

## Industry manifest

```json
{
  "schemaVersion": 1,
  "type": "industry",
  "id": "research-paper",
  "displayName": "Research Paper",
  "industry": "academic-research",
  "description": "Evidence-grounded academic research workflows.",
  "compatibleOnPeople": ">=0.29.0",
  "instructions": "./instructions/research-agent.md",
  "languages": ["zh-CN", "en"],
  "capabilities": ["literature-review", "citation-verification"],
  "workflows": [
    {
      "id": "new-paper",
      "name": "New paper",
      "description": "Start a traceable paper project.",
      "prompt": "Create a research project plan."
    }
  ],
  "templates": [
    { "id": "article-outline", "name": "Article outline", "path": "./templates/article.md" }
  ],
  "policies": [
    { "id": "integrity", "name": "Research integrity", "path": "./policies/integrity.md" }
  ],
  "evals": [
    { "id": "grounding", "name": "Citation grounding", "path": "./evals/grounding.json" }
  ]
}
```

All IDs use lower-case hyphen-case. All file paths must be relative, resolve to regular files, and remain inside the real plugin directory after symlink resolution. Industry instructions are capped at 64 KiB. Lists and workflow prompts are bounded by the runtime validator.

## Lifecycle

1. A marketplace exposes a standard plugin.
2. OnPeople validates and installs it through the App Server plugin API.
3. The user configures any Apps, MCP credentials, or project settings.
4. The user explicitly selects one installed industry plugin from the composer plus menu for the current conversation or turn.
5. OnPeople snapshots its ID, version, workflow metadata, and instructions into that task record; a new task starts without an industry plugin unless the user selects one again.
6. Existing tasks and forks retain their snapshot. Upgrades affect new tasks unless the user explicitly migrates an old task.
7. Removing the selection affects only the current draft. Uninstalling does not delete user-created project artifacts.

Only one primary industry plugin may be active. Standard capability plugins, Skills, Apps, and MCP servers can be composed with it.

## Security boundary

Industry manifests are declarative. They cannot inject desktop-shell or renderer code, access secrets directly, widen the active sandbox, or override OnPeople Core safety rules. External execution and network integrations use the existing MCP, App, approval, and secret-storage boundaries.
