function isNavigationAbort(error) {
  return error?.errno === -3
    || error?.code === "ERR_ABORTED"
    || /ERR_ABORTED\s*\(-3\)/.test(String(error?.message || error));
}

const DEFAULT_SEARCH_URL = "https://www.google.com.hk/search";

function looksLikeHost(value) {
  const candidate = value.split(/[/?#]/, 1)[0];
  const hostWithoutPort = candidate.replace(/:\d+$/, "");
  return hostWithoutPort === "localhost"
    || hostWithoutPort.endsWith(".localhost")
    || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(candidate)
    || /^\[[0-9a-f:]+\](?::\d+)?$/i.test(candidate)
    || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d+)?$/i.test(candidate);
}

function isLoopbackHost(value) {
  const candidate = value.split(/[/?#]/, 1)[0];
  const hostWithoutPort = candidate.replace(/:\d+$/, "");
  return hostWithoutPort === "localhost"
    || hostWithoutPort.endsWith(".localhost")
    || hostWithoutPort === "127.0.0.1"
    || hostWithoutPort === "[::1]";
}

function searchUrl(query, endpoint = DEFAULT_SEARCH_URL) {
  const url = new URL(endpoint);
  url.searchParams.set("q", query);
  return url;
}

function resolveAddressInput(input, options = {}) {
  const value = String(input || "").trim();
  if (!value) throw new Error("Enter a URL or search query");

  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("Only HTTP(S) URLs are allowed");
    return { url, kind: "url", input: value };
  }

  if (!/\s/.test(value) && looksLikeHost(value)) {
    // Loopback dev servers rarely speak TLS — default them to http.
    const scheme = isLoopbackHost(value) ? "http" : "https";
    return { url: new URL(`${scheme}://${value}`), kind: "url", input: value };
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    throw new Error("Only HTTP(S) URLs are allowed");
  }

  const query = value.startsWith("?") ? value.slice(1).trim() : value;
  return { url: searchUrl(query, options.searchUrl), kind: "search", input: value, query };
}

async function loadWebContentsUrl(target, url) {
  try {
    await target.loadURL(url);
    return { url: target.getURL() || url, replaced: false };
  } catch (error) {
    if (!isNavigationAbort(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { url: target.getURL() || url, replaced: true };
  }
}

module.exports = { DEFAULT_SEARCH_URL, isNavigationAbort, loadWebContentsUrl, looksLikeHost, resolveAddressInput };
