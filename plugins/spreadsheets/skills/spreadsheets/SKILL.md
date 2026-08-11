---
name: spreadsheets
description: Create, inspect, and verify XLSX spreadsheet artifacts in the active OnPeople workspace. Use for Excel files, tables, formulas, data summaries, and workbook generation.
---

# Spreadsheets

Use the OnPeople `workspace_artifacts` tools for workbook tasks.

1. Inspect an existing workbook with `artifact_inspect` before changing or summarizing it.
2. Create workbooks with `artifact_create_spreadsheet`. Provide named sheets and two-dimensional `rows` arrays.
3. Use native numbers and booleans instead of formatted strings. For a formula cell, use `{ "formula": "=SUM(A2:A10)" }`.
4. Keep headers in the first row and use stable, descriptive sheet names.
5. Require `verified: true`, then report the path and sheet names.

Never invent missing data. Preserve the source workbook unless replacement was explicitly requested.
