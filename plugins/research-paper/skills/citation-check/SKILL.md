---
name: citation-check
description: Audit academic claims, in-text citations, quotations, and bibliography metadata without inventing missing references.
---

# Citation Check

Use this skill to verify citation grounding and bibliography consistency.

1. Extract each material claim and its nearby citation.
2. Classify support as direct, partial, contradictory, irrelevant, or unavailable.
3. Deduplicate DOI-bearing references, call `research_verify_reference` once per unique DOI, cache the result for the task, and inspect every mismatch and partial-source failure. Use `research_resolve_doi` when only identifier resolution is needed.
4. Verify title, authors, venue, year, volume, pages, DOI or stable identifier against authoritative metadata. Connector metadata can verify identity and fields, but cannot verify whether the paper supports a claim.
5. Check quotations against the original wording and location.
6. Check that every in-text citation has a bibliography entry and every bibliography entry is used.
7. Report missing evidence with placeholders; never complete a reference from plausibility alone.
8. In user-facing results, say “核验参考文献” and describe evidence availability in ordinary language. Do not expose connector function names, internal evidence fields, provider names, or raw HTTP codes.
