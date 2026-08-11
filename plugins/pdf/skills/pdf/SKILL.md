---
name: pdf
description: Create, inspect, and verify PDF artifacts in the active OnPeople workspace. Use when the requested output or input is a PDF.
---

# PDF

Use the OnPeople `workspace_artifacts` tools for PDF work.

1. Inspect an existing PDF with `artifact_inspect` to collect page count and extractable text.
2. Create a PDF with `artifact_create_pdf`, using a workspace-relative output path, a title, and ordered sections.
3. Preserve the source file by default and write to a new output path.
4. Require `verified: true` from the tool before reporting success.
5. Return the resulting path. If exact visual layout matters, explicitly recommend a visual review of the generated PDF.

Do not claim that scanned text was read when no extractable text is returned.
