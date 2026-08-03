---
name: literature-review
description: Build a reproducible bilingual literature search, screening log, evidence matrix, synthesis, and research-gap analysis for an academic paper.
---

# Literature Review

Use this skill for literature discovery, screening, evidence extraction, synthesis, and review writing.

1. Confirm the research question, field, date range, source types, languages, and inclusion/exclusion criteria.
2. When current public discovery is needed, call `research_search_papers` with domain-appropriate sources. Use `research_search_datasets` for datasets or software and `research_search_trials` for trial-registry questions.
3. Record databases or sources, exact queries, filters, search dates, result counts, partial failures, and coverage limits when searches are performed.
4. Resolve a DOI or verify bibliographic metadata before marking an item as included. Do not treat metadata, an abstract, or a full-text link as proof that the underlying paper supports a claim.
5. Build an evidence matrix with study context, method, sample or dataset, findings, limitations, and relevance.
6. Synthesize by concepts, methods, results, and disagreements rather than producing a list of summaries.
7. Distinguish an evidence-backed research gap from a topic that was merely absent from a narrow search.
8. Mark unavailable full text, unresolved metadata, and uncertain interpretations explicitly.
