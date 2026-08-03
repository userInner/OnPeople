const { marked, Renderer } = require("marked");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHref(value, { image = false } = {}) {
  const href = String(value || "").trim();
  if (!href) return "";
  if (href.startsWith("#") || href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) return href;
  if (!/^[a-z][a-z\d+.-]*:/i.test(href)) return href;
  try {
    const url = new URL(href);
    const allowed = image ? new Set(["http:", "https:"]) : new Set(["http:", "https:", "mailto:"]);
    return allowed.has(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function markdownBody(source) {
  const renderer = new Renderer();
  renderer.html = ({ text }) => `<pre class="raw-html"><code>${escapeHtml(text)}</code></pre>`;
  renderer.link = ({ href, title, tokens }) => {
    const content = renderer.parser.parseInline(tokens);
    const safe = safeHref(href);
    if (!safe) return content;
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    const external = /^https?:\/\//i.test(safe) ? ' target="_blank" rel="noreferrer"' : "";
    return `<a href="${escapeHtml(safe)}"${titleAttribute}${external}>${content}</a>`;
  };
  renderer.image = ({ href, title, text }) => {
    const safe = safeHref(href, { image: true });
    if (!safe) return escapeHtml(text || "");
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text || "")}"${titleAttribute} loading="lazy">`;
  };
  return marked.parse(String(source || ""), { gfm: true, breaks: false, renderer });
}

function renderMarkdownPreview({ source, name, relativePath, rawUrl }) {
  const title = escapeHtml(name || "Markdown 文档");
  const relative = escapeHtml(relativePath || name || "");
  const raw = escapeHtml(rawUrl || "?raw=1");
  const body = markdownBody(source);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' http: https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>${title}</title>
  <style>
    :root { color-scheme: light; --ink:#282b2f; --muted:#747b82; --line:#e2e5e7; --soft:#f5f6f7; --link:#276eaa; }
    * { box-sizing: border-box; }
    body { margin:0; background:#f5f6f4; color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei UI",sans-serif; }
    .bar { position:sticky; z-index:2; top:0; display:flex; align-items:center; gap:16px; min-height:58px; padding:10px 20px; border-bottom:1px solid var(--line); background:rgba(255,255,255,.96); backdrop-filter:blur(14px); }
    .identity { min-width:0; flex:1; }
    .identity strong,.identity span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .identity strong { font-size:14px; font-weight:650; }
    .identity span { margin-top:3px; color:var(--muted); font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .raw-link { flex:none; padding:6px 9px; border:1px solid #d8dcdf; border-radius:6px; color:#5d656c; font-size:10px; text-decoration:none; }
    .raw-link:hover { border-color:#b9c1c7; background:var(--soft); color:var(--ink); }
    main { width:min(860px,calc(100% - 36px)); margin:24px auto 64px; padding:34px 38px 48px; border:1px solid #dedfdb; border-radius:8px; background:#fff; box-shadow:0 10px 32px rgba(30,34,37,.05); font-size:15px; line-height:1.78; overflow-wrap:anywhere; }
    main > :first-child { margin-top:0; } main > :last-child { margin-bottom:0; }
    h1,h2,h3,h4,h5,h6 { margin:1.6em 0 .65em; color:#202327; line-height:1.35; letter-spacing:0; }
    h1 { padding-bottom:.42em; border-bottom:1px solid var(--line); font-size:25px; font-weight:680; }
    h2 { padding-bottom:.3em; border-bottom:1px solid #eceeed; font-size:20px; font-weight:660; }
    h3 { font-size:17px; font-weight:650; } h4,h5,h6 { font-size:15px; font-weight:650; }
    p { margin:.75em 0 1em; } ul,ol { margin:.7em 0 1em; padding-left:1.65em; } li { margin:.35em 0; }
    a { color:var(--link); text-decoration:underline; text-decoration-color:#a9c8df; text-underline-offset:3px; }
    blockquote { margin:1.1em 0; padding:.15em 1em; border-left:3px solid #91a89c; background:#f7f9f8; color:#59625d; }
    blockquote p { margin:.65em 0; }
    code { padding:.14em .36em; border:1px solid #e1e4e6; border-radius:4px; background:#f2f3f4; font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; }
    pre { margin:1.1em 0; padding:15px 17px; overflow:auto; border:1px solid #dfe2e4; border-radius:7px; background:#f4f5f6; }
    pre code { padding:0; border:0; background:transparent; font-size:12px; white-space:pre; }
    .raw-html { border-left:3px solid #c9a36b; }
    table { width:100%; margin:1.1em 0; border-collapse:collapse; font-size:13px; }
    th,td { padding:8px 10px; border:1px solid #dde1e3; text-align:left; vertical-align:top; }
    th { background:#f3f5f6; font-weight:650; }
    img { display:block; max-width:100%; height:auto; margin:18px auto; }
    hr { margin:2em 0; border:0; border-top:1px solid var(--line); }
    input[type="checkbox"] { margin-right:.5em; accent-color:#47765e; }
    @media (max-width:680px) { .bar { padding:9px 12px; } main { width:100%; margin:0; padding:24px 18px 44px; border:0; border-radius:0; box-shadow:none; } h1 { font-size:22px; } }
  </style>
</head>
<body>
  <header class="bar"><div class="identity"><strong>${title}</strong><span>${relative}</span></div><a class="raw-link" href="${raw}">查看原文</a></header>
  <main>${body}</main>
</body>
</html>`;
}

module.exports = { markdownBody, renderMarkdownPreview, safeHref };
