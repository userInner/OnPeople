---
name: documents
description: Create, inspect, and verify DOCX document artifacts in the active OnPeople workspace. Use for Word documents, reports, briefs, structured text, and tables.
---

# Documents

Use the OnPeople `workspace_artifacts` tools for document work.

1. Inspect an existing document with `artifact_inspect` before editing or reconstructing it.
2. Create a new DOCX with `artifact_create_document`. Supply a workspace-relative `output`, a concise `title`, ordered `sections`, and structured `tables` where appropriate.
3. Never overwrite an input document unless the user explicitly asks. Prefer a new, descriptive filename.
4. Treat a result as complete only when the tool returns `verified: true`.
5. Return the generated file path and briefly state what was created. If layout is important, ask the user to open the artifact or use the available preview workflow to verify it visually.

Do not place secrets in generated documents or write outside the active workspace.
