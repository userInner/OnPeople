---
name: visualize
description: Create standalone interactive HTML visualizations in the active OnPeople workspace. Use for charts, comparisons, distributions, trends, and data storytelling.
---

# Visualize

Use `artifact_create_visualization` from `workspace_artifacts`.

1. Normalize the source into objects with stable labels and numeric values.
2. Choose `bar` for comparisons, `line` for ordered trends, and `scatter` for paired numeric observations.
3. Provide an explicit title and workspace-relative output path.
4. Require `verified: true`, then open the generated HTML with the system default application for visual verification.
5. State any assumptions, omitted rows, or coercions made while preparing the data.

Do not fabricate values or silently discard invalid records.
