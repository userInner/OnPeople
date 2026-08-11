---
name: template-creator
description: Create and apply reusable structured artifact templates in the active OnPeople workspace. Use when the user wants a repeatable document or content pattern.
---

# Template Creator

Use `artifact_create_template` and `artifact_apply_template` from `workspace_artifacts`.

1. Represent replaceable values as `{{name}}` placeholders inside strings.
2. Store the reusable structure with `artifact_create_template`, including an explicit `kind`.
3. Apply it with `artifact_apply_template`, passing a `values` object whose keys match the placeholders.
4. Inspect or preview the result before claiming completion.
5. If the applied result is intermediate JSON, pass it to the matching document, spreadsheet, presentation, site, or visualization creator.

Keep templates generic and do not embed credentials, tokens, or private user data.
