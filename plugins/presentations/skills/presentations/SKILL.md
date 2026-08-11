---
name: presentations
description: Create, inspect, and verify PPTX presentation artifacts in the active OnPeople workspace. Use for slide decks, presentations, and PowerPoint files.
---

# Presentations

Use the OnPeople `workspace_artifacts` tools for presentation work.

1. Inspect an existing PPTX with `artifact_inspect` before rewriting or summarizing it.
2. Create a deck with `artifact_create_presentation`. Give every slide a short title and a focused body.
3. Prefer one main idea per slide and concise, presentation-ready language.
4. Preserve source files unless the user explicitly requests replacement.
5. Require `verified: true`, return the path, and recommend a visual review when layout is important.
