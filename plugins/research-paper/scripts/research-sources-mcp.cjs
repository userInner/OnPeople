#!/usr/bin/env node
"use strict";

const readline = require("node:readline");

const USER_AGENT = "OnPeople-Research-Paper/1.0 (public metadata connector; no credentials)";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_RESULTS = 25;
const MAX_CONCURRENCY = 4;
const ALLOWED_HOSTS = new Set([
  "api.crossref.org", "api.openalex.org", "api.datacite.org", "eutils.ncbi.nlm.nih.gov",
  "www.ebi.ac.uk", "export.arxiv.org", "dblp.org", "doaj.org", "zenodo.org",
  "api.osf.io", "api.ror.org", "clinicaltrials.gov",
]);
let activeRequests = 0;
const requestWaiters = [];

function clampLimit(value, fallback = 10) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_RESULTS, parsed)) : fallback;
}

function cleanText(value, max = 4_000) {
  if (Array.isArray(value)) value = value[0];
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function requiredText(value, name) {
  const text = cleanText(value, 500);
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function normalizeDoi(value) {
  return cleanText(value, 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").trim().toLowerCase();
}

function yearOf(value) {
  const match = String(value ?? "").match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function names(values) {
  return (Array.isArray(values) ? values : []).map((item) => {
    if (typeof item === "string") return cleanText(item, 300);
    return cleanText(item?.name || item?.display_name || [item?.given, item?.family].filter(Boolean).join(" "), 300);
  }).filter(Boolean).slice(0, 100);
}

function record(source, input = {}) {
  const doi = normalizeDoi(input.doi);
  return {
    source,
    sourceRecordUrl: input.sourceRecordUrl || (doi ? `https://doi.org/${encodeURIComponent(doi)}` : null),
    retrievedAt: new Date().toISOString(),
    verificationStatus: input.verificationStatus || "source-metadata",
    evidenceLevel: input.fullTextUrl ? "public-full-text-link" : input.abstract ? "abstract" : "metadata-only",
    identifiers: { ...(doi ? { doi } : {}), ...(input.identifiers || {}) },
    title: cleanText(input.title, 1_000),
    authors: names(input.authors),
    year: yearOf(input.year || input.published),
    venue: cleanText(input.venue, 500) || null,
    type: cleanText(input.type, 100) || null,
    abstract: cleanText(input.abstract, 8_000) || null,
    fullTextUrl: input.fullTextUrl || null,
    citationCount: Number.isFinite(Number(input.citationCount)) ? Number(input.citationCount) : null,
  };
}

async function withSlot(task) {
  if (activeRequests >= MAX_CONCURRENCY) await new Promise((resolve) => requestWaiters.push(resolve));
  activeRequests += 1;
  try { return await task(); }
  finally {
    activeRequests -= 1;
    requestWaiters.shift()?.();
  }
}

async function readBounded(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("upstream response exceeds size limit");
  if (!response.body) return "";
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_RESPONSE_BYTES) throw new Error("upstream response exceeds size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function request(url, { accept = "application/json", attempts = 2 } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) throw new Error(`blocked upstream host: ${parsed.hostname}`);
  return withSlot(async () => {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(parsed, {
          headers: { accept, "user-agent": USER_AGENT }, signal: controller.signal, redirect: "error",
        });
        if (!response.ok) {
          const error = new Error(`upstream HTTP ${response.status}`);
          error.transient = response.status === 429 || response.status >= 500;
          throw error;
        }
        const text = await readBounded(response);
        return accept.includes("json") ? JSON.parse(text) : text;
      } catch (error) {
        lastError = error;
        if (attempt + 1 >= attempts || (!error.transient && error.name !== "AbortError")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      } finally { clearTimeout(timer); }
    }
    throw lastError;
  });
}

function queryUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  return url.toString();
}

function yearFilter(input) {
  const from = yearOf(input.yearFrom);
  const to = yearOf(input.yearTo);
  return { from, to };
}

function inYearRange(item, input) {
  const { from, to } = yearFilter(input);
  return (!from || !item.year || item.year >= from) && (!to || !item.year || item.year <= to);
}

async function searchCrossref(query, limit, input) {
  const filters = [];
  const { from, to } = yearFilter(input);
  if (from) filters.push(`from-pub-date:${from}-01-01`);
  if (to) filters.push(`until-pub-date:${to}-12-31`);
  const data = await request(queryUrl("https://api.crossref.org/works", { query, rows: limit, filter: filters.join(",") }));
  return (data.message?.items || []).map((item) => record("crossref", {
    doi: item.DOI, title: item.title, authors: item.author, year: item.published?.["date-parts"]?.[0]?.[0],
    venue: item["container-title"], type: item.type, sourceRecordUrl: item.URL,
  }));
}

async function searchOpenAlex(query, limit, input) {
  const filters = [];
  const { from, to } = yearFilter(input);
  if (from) filters.push(`from_publication_date:${from}-01-01`);
  if (to) filters.push(`to_publication_date:${to}-12-31`);
  const data = await request(queryUrl("https://api.openalex.org/works", { search: query, "per-page": limit, filter: filters.join(",") }));
  return (data.results || []).map((item) => record("openalex", {
    doi: item.doi, title: item.title, authors: item.authorships?.map((entry) => entry.author?.display_name), year: item.publication_year,
    venue: item.primary_location?.source?.display_name, type: item.type, citationCount: item.cited_by_count,
    sourceRecordUrl: item.id, fullTextUrl: item.open_access?.is_oa ? item.best_oa_location?.pdf_url || item.best_oa_location?.landing_page_url : null,
    identifiers: { openalex: item.id },
  }));
}

async function searchDataCite(query, limit, input) {
  const data = await request(queryUrl("https://api.datacite.org/dois", { query, "page[size]": limit }));
  return (data.data || []).map((entry) => {
    const item = entry.attributes || {};
    return record("datacite", {
      doi: item.doi, title: item.titles?.[0]?.title, authors: item.creators, year: item.publicationYear,
      venue: item.publisher, type: item.types?.resourceTypeGeneral, abstract: item.descriptions?.find((d) => d.descriptionType === "Abstract")?.description,
      sourceRecordUrl: `https://api.datacite.org/dois/${encodeURIComponent(item.doi || entry.id)}`,
    });
  }).filter((item) => inYearRange(item, input));
}

async function searchPubMed(query, limit, input) {
  const { from, to } = yearFilter(input);
  const dated = from || to ? `${query} AND ${from || 1000}:${to || 3000}[pdat]` : query;
  const found = await request(queryUrl("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", { db: "pubmed", term: dated, retmode: "json", retmax: limit }));
  const ids = found.esearchresult?.idlist || [];
  if (!ids.length) return [];
  const summaries = await request(queryUrl("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", { db: "pubmed", id: ids.join(","), retmode: "json" }));
  return ids.map((id) => summaries.result?.[id]).filter(Boolean).map((item) => record("pubmed", {
    title: item.title, authors: item.authors, year: item.pubdate, venue: item.fulljournalname || item.source, type: item.pubtype?.[0],
    identifiers: { pmid: String(item.uid) }, sourceRecordUrl: `https://pubmed.ncbi.nlm.nih.gov/${item.uid}/`,
    doi: item.articleids?.find((value) => value.idtype === "doi")?.value,
  }));
}

async function searchEuropePmc(query, limit, input, source = "europe-pmc") {
  const { from, to } = yearFilter(input);
  let scoped = query;
  if (source === "biorxiv") scoped = `(${query}) AND JOURNAL:\"bioRxiv\"`;
  if (source === "medrxiv") scoped = `(${query}) AND JOURNAL:\"medRxiv\"`;
  if (from || to) scoped += ` AND FIRST_PDATE:[${from || 1000}-01-01 TO ${to || 3000}-12-31]`;
  const data = await request(queryUrl("https://www.ebi.ac.uk/europepmc/webservices/rest/search", { query: scoped, format: "json", pageSize: limit, resultType: "core" }));
  return (data.resultList?.result || []).map((item) => record(source, {
    doi: item.doi, title: item.title, authors: item.authorList?.author?.map((author) => author.fullName), year: item.pubYear,
    venue: item.journalTitle, type: item.pubType, abstract: item.abstractText, citationCount: item.citedByCount,
    identifiers: { ...(item.pmid ? { pmid: item.pmid } : {}), ...(item.pmcid ? { pmcid: item.pmcid } : {}) },
    sourceRecordUrl: `https://europepmc.org/article/${item.source}/${item.id}`,
    fullTextUrl: item.isOpenAccess === "Y" && item.pmcid ? `https://europepmc.org/articles/${item.pmcid}` : null,
  }));
}

function xmlDecode(value) {
  return String(value || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

function xmlBlocks(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...String(xml).matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "gi"))].map((match) => match[1]);
}

function xmlValues(xml, tag) {
  return xmlBlocks(xml, tag).map((value) => xmlDecode(cleanText(value, 10_000)));
}

async function searchArxiv(query, limit, input) {
  const xml = await request(queryUrl("https://export.arxiv.org/api/query", { search_query: `all:${query}`, start: 0, max_results: limit, sortBy: "relevance" }), { accept: "application/atom+xml" });
  return xmlBlocks(xml, "entry").map((entry) => {
    const id = xmlValues(entry, "id")[0];
    return record("arxiv", {
      title: xmlValues(entry, "title")[0], authors: xmlValues(entry, "name"), year: xmlValues(entry, "published")[0],
      abstract: xmlValues(entry, "summary")[0], type: "preprint", sourceRecordUrl: id,
      identifiers: { arxiv: id?.split("/abs/")[1] }, fullTextUrl: id?.replace("/abs/", "/pdf/"),
      doi: xmlValues(entry, "arxiv:doi")[0],
    });
  }).filter((item) => inYearRange(item, input));
}

async function searchDblp(query, limit, input) {
  const data = await request(queryUrl("https://dblp.org/search/publ/api", { q: query, h: limit, format: "json" }));
  const hits = data.result?.hits?.hit || [];
  return (Array.isArray(hits) ? hits : [hits]).map((hit) => hit.info || {}).map((item) => record("dblp", {
    doi: item.doi, title: item.title, authors: item.authors?.author, year: item.year, venue: item.venue, type: item.type,
    sourceRecordUrl: item.url, identifiers: { dblp: item.key },
  })).filter((item) => inYearRange(item, input));
}

async function searchDoaj(query, limit, input) {
  const url = `https://doaj.org/api/search/articles/${encodeURIComponent(`bibjson.title:${query}`)}?pageSize=${limit}`;
  const data = await request(url);
  return (data.results || []).map((entry) => {
    const item = entry.bibjson || {};
    return record("doaj", {
      doi: item.identifier?.find((id) => id.type === "doi")?.id, title: item.title, authors: item.author,
      year: item.year, venue: item.journal?.title, type: "journal-article", abstract: item.abstract,
      sourceRecordUrl: item.link?.find((link) => link.type === "fulltext")?.url || `https://doaj.org/article/${entry.id}`,
      fullTextUrl: item.link?.find((link) => link.type === "fulltext")?.url,
      identifiers: { doaj: entry.id },
    });
  }).filter((item) => inYearRange(item, input));
}

const PAPER_SOURCES = {
  crossref: searchCrossref, openalex: searchOpenAlex, pubmed: searchPubMed, "europe-pmc": searchEuropePmc,
  arxiv: searchArxiv, dblp: searchDblp, doaj: searchDoaj,
  biorxiv: (q, l, i) => searchEuropePmc(q, l, i, "biorxiv"),
  medrxiv: (q, l, i) => searchEuropePmc(q, l, i, "medrxiv"),
};

function chooseSources(requested, available, defaults) {
  if (requested === undefined || requested === null) return defaults;
  if (!Array.isArray(requested) || !requested.length) throw new Error("sources must be a non-empty array");
  const values = [...new Set(requested.map((value) => cleanText(value, 80).toLowerCase()))];
  const unknown = values.filter((value) => !available[value]);
  if (unknown.length) throw new Error(`unsupported sources: ${unknown.join(", ")}`);
  return values;
}

function deduplicate(records) {
  const output = [];
  const seen = new Map();
  for (const item of records) {
    const doi = normalizeDoi(item.identifiers?.doi);
    const titleKey = cleanText(item.title, 1_000).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const key = doi ? `doi:${doi}` : titleKey ? `title:${titleKey}` : `${item.source}:${item.sourceRecordUrl}`;
    if (!seen.has(key)) {
      item.matchedSources = [item.source];
      seen.set(key, output.length);
      output.push(item);
      continue;
    }
    const existing = output[seen.get(key)];
    existing.matchedSources = [...new Set([...existing.matchedSources, item.source])];
    if (!existing.abstract && item.abstract) { existing.abstract = item.abstract; existing.evidenceLevel = item.evidenceLevel; }
    if (!existing.fullTextUrl && item.fullTextUrl) { existing.fullTextUrl = item.fullTextUrl; existing.evidenceLevel = "public-full-text-link"; }
    if (!existing.citationCount && item.citationCount) existing.citationCount = item.citationCount;
  }
  return output;
}

async function runSources(sourceNames, available, query, limit, input) {
  const settled = await Promise.allSettled(sourceNames.map(async (source) => ({ source, results: await available[source](query, limit, input) })));
  const resultGroups = [];
  const sources = [];
  settled.forEach((entry, index) => {
    const source = sourceNames[index];
    if (entry.status === "fulfilled") {
      resultGroups.push(entry.value.results);
      sources.push({ source, status: "ok", resultCount: entry.value.results.length });
    } else sources.push({ source, status: "error", error: cleanText(entry.reason?.message || entry.reason, 500) });
  });
  const results = [];
  for (let index = 0; resultGroups.some((group) => index < group.length); index += 1) {
    for (const group of resultGroups) if (group[index]) results.push(group[index]);
  }
  return { results, sources };
}

async function searchPapers(input = {}) {
  const query = requiredText(input.query, "query");
  const limit = clampLimit(input.limit);
  const selected = chooseSources(input.sources, PAPER_SOURCES, ["crossref", "openalex", "pubmed", "europe-pmc", "arxiv", "dblp", "doaj"]);
  const searched = await runSources(selected, PAPER_SOURCES, query, limit, input);
  return {
    query, resultCount: 0, results: [], sources: searched.sources,
    notice: "Search results expose metadata, abstracts, and public full-text links only. Verify claims against the actual source text.",
    ...(() => { const results = deduplicate(searched.results).slice(0, limit); return { resultCount: results.length, results }; })(),
  };
}

async function resolveDoi(input = {}) {
  const doi = normalizeDoi(requiredText(input.doi, "doi"));
  if (!/^10\.\d{4,9}\/.+/.test(doi)) throw new Error("doi is not valid");
  const tasks = [
    ["crossref", async () => {
      const data = await request(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
      const item = data.message || {};
      return record("crossref", { doi: item.DOI, title: item.title, authors: item.author, year: item.published?.["date-parts"]?.[0]?.[0], venue: item["container-title"], type: item.type, sourceRecordUrl: item.URL, verificationStatus: "doi-resolved" });
    }],
    ["datacite", async () => {
      const data = await request(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`);
      const item = data.data?.attributes || {};
      return record("datacite", { doi: item.doi, title: item.titles?.[0]?.title, authors: item.creators, year: item.publicationYear, venue: item.publisher, type: item.types?.resourceTypeGeneral, abstract: item.descriptions?.[0]?.description, sourceRecordUrl: `https://doi.org/${doi}`, verificationStatus: "doi-resolved" });
    }],
  ];
  const settled = await Promise.allSettled(tasks.map(([, fn]) => fn()));
  const records = settled.filter((item) => item.status === "fulfilled").map((item) => item.value);
  return { doi, found: records.length > 0, records, sources: settled.map((item, i) => item.status === "fulfilled" ? { source: tasks[i][0], status: "ok" } : { source: tasks[i][0], status: "error", error: cleanText(item.reason?.message, 500) }) };
}

function comparable(value) {
  return cleanText(value, 2_000).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

async function verifyReference(input = {}) {
  const resolved = await resolveDoi({ doi: input.doi });
  const supplied = { title: cleanText(input.title, 1_000), authors: names(input.authors), year: yearOf(input.year), venue: cleanText(input.venue, 500) };
  const best = resolved.records[0] || null;
  const checks = {};
  if (best) {
    if (supplied.title) checks.title = { status: comparable(supplied.title) === comparable(best.title) ? "match" : "mismatch", supplied: supplied.title, authoritative: best.title };
    if (supplied.year) checks.year = { status: supplied.year === best.year ? "match" : "mismatch", supplied: supplied.year, authoritative: best.year };
    if (supplied.venue) checks.venue = { status: comparable(supplied.venue) === comparable(best.venue) ? "match" : "mismatch", supplied: supplied.venue, authoritative: best.venue };
    if (supplied.authors.length) {
      const expected = supplied.authors.map(comparable);
      const actual = best.authors.map(comparable);
      checks.authors = { status: expected.every((name) => actual.includes(name)) ? "match" : "mismatch", supplied: supplied.authors, authoritative: best.authors };
    }
  }
  const statuses = Object.values(checks).map((value) => value.status);
  return { doi: resolved.doi, verificationStatus: !best ? "not-found" : statuses.includes("mismatch") ? "metadata-mismatch" : "verified", checks, authoritativeRecord: best, sources: resolved.sources };
}

async function searchZenodo(query, limit) {
  const data = await request(queryUrl("https://zenodo.org/api/records", { q: query, size: limit }));
  return (data.hits?.hits || []).map((item) => record("zenodo", {
    doi: item.doi, title: item.metadata?.title, authors: item.metadata?.creators, year: item.metadata?.publication_date,
    venue: "Zenodo", type: item.metadata?.resource_type?.type || item.metadata?.upload_type, abstract: item.metadata?.description,
    identifiers: { zenodo: String(item.id) }, sourceRecordUrl: item.links?.html, fullTextUrl: item.files?.[0]?.links?.self,
  }));
}

async function searchOsf(query, limit) {
  const data = await request(queryUrl("https://api.osf.io/v2/preprints/", { "filter[title]": query, "page[size]": limit }));
  return (data.data || []).map((entry) => record("osf", {
    doi: entry.attributes?.doi, title: entry.attributes?.title, year: entry.attributes?.date_published,
    venue: entry.attributes?.provider?.name || "OSF Preprints", type: "preprint", identifiers: { osf: entry.id },
    sourceRecordUrl: entry.links?.html, abstract: entry.attributes?.description,
  }));
}

const DATASET_SOURCES = { datacite: searchDataCite, zenodo: searchZenodo, osf: searchOsf };

async function searchDatasets(input = {}) {
  const query = requiredText(input.query, "query");
  const limit = clampLimit(input.limit);
  const selected = chooseSources(input.sources, DATASET_SOURCES, ["datacite", "zenodo", "osf"]);
  const searched = await runSources(selected, DATASET_SOURCES, query, limit, input);
  const results = deduplicate(searched.results).slice(0, limit);
  return { query, resultCount: results.length, results, sources: searched.sources, notice: "Records are repository metadata. Inspect files, licenses, versions, and methods before reuse." };
}

async function lookupInstitution(input = {}) {
  const query = requiredText(input.query, "query");
  const limit = clampLimit(input.limit, 10);
  const data = await request(queryUrl("https://api.ror.org/v2/organizations", { query, page: 1 }));
  const items = (data.items || []).slice(0, limit).map((item) => ({
    source: "ror", sourceRecordUrl: item.id, retrievedAt: new Date().toISOString(), verificationStatus: "source-metadata",
    identifiers: { ror: item.id }, name: item.names?.find((name) => name.types?.includes("ror_display"))?.value || item.names?.[0]?.value,
    aliases: item.names?.filter((name) => !name.types?.includes("ror_display")).map((name) => name.value).slice(0, 20) || [],
    types: item.types || [], country: item.locations?.[0]?.geonames_details?.country_name || null,
    website: item.links?.find((link) => link.type === "website")?.value || null,
  }));
  return { query, resultCount: items.length, results: items, sources: [{ source: "ror", status: "ok", resultCount: items.length }] };
}

async function searchTrials(input = {}) {
  const query = requiredText(input.query, "query");
  const limit = clampLimit(input.limit);
  const data = await request(queryUrl("https://clinicaltrials.gov/api/v2/studies", { "query.term": query, pageSize: limit, format: "json" }));
  const results = (data.studies || []).map((study) => {
    const protocol = study.protocolSection || {};
    const id = protocol.identificationModule?.nctId;
    return {
      source: "clinicaltrials.gov", sourceRecordUrl: `https://clinicaltrials.gov/study/${id}`, retrievedAt: new Date().toISOString(),
      verificationStatus: "registry-record", evidenceLevel: "registry-metadata", identifiers: { nct: id },
      title: protocol.identificationModule?.briefTitle, officialTitle: protocol.identificationModule?.officialTitle || null,
      status: protocol.statusModule?.overallStatus || null, studyType: protocol.designModule?.studyType || null,
      conditions: protocol.conditionsModule?.conditions || [], interventions: protocol.armsInterventionsModule?.interventions?.map((item) => item.name) || [],
      sponsor: protocol.sponsorCollaboratorsModule?.leadSponsor?.name || null,
    };
  });
  return { query, resultCount: results.length, results, sources: [{ source: "clinicaltrials.gov", status: "ok", resultCount: results.length }], notice: "Registry records describe planned or ongoing studies and are not evidence of efficacy or published results." };
}

async function sourceStatus() {
  return {
    authentication: "none", access: "read-only", requestPolicy: { httpsOnly: true, timeoutMs: REQUEST_TIMEOUT_MS, maxResponseBytes: MAX_RESPONSE_BYTES, maxConcurrentRequests: MAX_CONCURRENCY },
    paperSources: Object.keys(PAPER_SOURCES), datasetSources: Object.keys(DATASET_SOURCES), otherSources: ["ror", "clinicaltrials.gov"],
    excludedDefaults: ["semantic-scholar", "google-scholar", "cnki", "wanfang", "vip", "web-of-science", "scopus", "dimensions", "lens", "core", "orcid", "unpaywall", "opencitations"],
  };
}

const tools = [
  { name: "research_search_papers", description: "Search anonymous scholarly metadata sources, normalize records, and deduplicate by DOI/title. Results are not a substitute for reading full text.", inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, sources: { type: "array", items: { enum: Object.keys(PAPER_SOURCES) } }, yearFrom: { type: "integer" }, yearTo: { type: "integer" }, limit: { type: "integer", minimum: 1, maximum: MAX_RESULTS } } } },
  { name: "research_resolve_doi", description: "Resolve a DOI against Crossref and DataCite without credentials.", inputSchema: { type: "object", required: ["doi"], properties: { doi: { type: "string" } } } },
  { name: "research_verify_reference", description: "Compare supplied citation fields with authoritative DOI metadata.", inputSchema: { type: "object", required: ["doi"], properties: { doi: { type: "string" }, title: { type: "string" }, authors: { type: "array", items: { type: "string" } }, year: { type: "integer" }, venue: { type: "string" } } } },
  { name: "research_search_datasets", description: "Search public dataset, software, and research-output metadata from DataCite, Zenodo, and OSF.", inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, sources: { type: "array", items: { enum: Object.keys(DATASET_SOURCES) } }, limit: { type: "integer", minimum: 1, maximum: MAX_RESULTS } } } },
  { name: "research_lookup_institution", description: "Look up research organizations in the public ROR registry.", inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: MAX_RESULTS } } } },
  { name: "research_search_trials", description: "Search public ClinicalTrials.gov registry records. Registry metadata is not evidence of efficacy.", inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: MAX_RESULTS } } } },
  { name: "research_source_status", description: "Describe available anonymous sources, security limits, and intentionally excluded credentialed sources.", inputSchema: { type: "object", properties: {} } },
];

const handlers = { research_search_papers: searchPapers, research_resolve_doi: resolveDoi, research_verify_reference: verifyReference, research_search_datasets: searchDatasets, research_lookup_institution: lookupInstitution, research_search_trials: searchTrials, research_source_status: sourceStatus };

function contentSummary(value) {
  const summary = { structuredResultsAttached: true };
  for (const key of ["query", "doi", "resultCount", "found", "verificationStatus", "notice"]) {
    if (value?.[key] !== undefined) summary[key] = value[key];
  }
  if (Array.isArray(value?.sources)) summary.sources = value.sources;
  if (value?.authentication) summary.authentication = value.authentication;
  if (value?.access) summary.access = value.access;
  return JSON.stringify(summary, null, 2);
}

function write(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }

async function handle(message) {
  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") return;
  try {
    if (message.method === "initialize") return write({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "onpeople-research-sources", version: "1.0.0" } } });
    if (message.method === "ping") return write({ jsonrpc: "2.0", id: message.id, result: {} });
    if (message.method === "tools/list") return write({ jsonrpc: "2.0", id: message.id, result: { tools } });
    if (message.method === "resources/list") return write({ jsonrpc: "2.0", id: message.id, result: { resources: [] } });
    if (message.method === "resources/templates/list") return write({ jsonrpc: "2.0", id: message.id, result: { resourceTemplates: [] } });
    if (message.method === "tools/call") {
      const handler = handlers[message.params?.name];
      if (!handler) throw new Error(`unknown tool: ${message.params?.name || "missing"}`);
      const value = await handler(message.params?.arguments || {});
      return write({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: contentSummary(value) }], structuredContent: value } });
    }
    if (message.id !== undefined) throw new Error(`unsupported MCP method: ${message.method}`);
  } catch (error) {
    if (message.id !== undefined) write({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: cleanText(error?.message || error, 1_000) } });
  }
}

if (require.main === module) {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    if (!line.trim()) return;
    try { void handle(JSON.parse(line)); }
    catch (error) { process.stderr.write(`${cleanText(error?.message || error)}\n`); }
  });
}

module.exports = { ALLOWED_HOSTS, DATASET_SOURCES, PAPER_SOURCES, contentSummary, deduplicate, handle, normalizeDoi, record, request, searchPapers, sourceStatus, tools, verifyReference };
