---
name: sites
description: Create responsive standalone HTML pages in the active OnPeople workspace. Use for landing pages, prototypes, reports, dashboards, and lightweight local sites.
---

# Sites

Use `artifact_create_site` from `workspace_artifacts`.

1. Derive a clear title, subtitle, and ordered sections from the request.
2. Keep the page self-contained: semantic HTML, responsive CSS, and no required external dependency.
3. Use structured section objects with `heading`, `body`, and optional `items`.
4. Require `verified: true`, then open the generated HTML with the system default application when visual verification is useful.
5. Do not publish or deploy the result unless the user separately authorizes a deployment destination.
