// Rule engine: turns crawled pages into scored, categorized SEO issues.
// Severity weights drive the 0-100 health score.

const SEVERITY_WEIGHT = { critical: 10, high: 6, medium: 3, low: 1 };

function parseLdJson(strings) {
  const out = [];
  for (const s of strings) {
    try {
      out.push(JSON.parse(s));
    } catch {
      out.push({ __invalid: true });
    }
  }
  return out;
}

function ldjsonTypes(parsed) {
  const types = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node['@type']) [].concat(node['@type']).forEach((t) => types.add(t));
    if (node['@graph']) walk(node['@graph']);
  };
  parsed.forEach(walk);
  return types;
}

// Schema types that matter for a travel agency.
const TRAVEL_SCHEMA = ['TravelAgency', 'TouristTrip', 'TouristAttraction', 'Trip', 'Product', 'Offer', 'FAQPage', 'BreadcrumbList'];

export function auditPages(crawlResult, config) {
  const { thresholds: t } = config;
  const issues = [];
  const add = (page, rule, severity, message, fixable = false) =>
    issues.push({ url: page.url, rule, severity, message, fixable });

  const titles = new Map();

  for (const page of crawlResult.pages) {
    if (page.status >= 400) {
      add(page, 'http-error', 'critical', `Page returns HTTP ${page.status}`);
      continue;
    }

    // --- Title ---
    if (!page.title) add(page, 'missing-title', 'critical', 'No <title> tag', true);
    else {
      if (page.title.length < t.titleMin) add(page, 'title-too-short', 'medium', `Title is ${page.title.length} chars (min ${t.titleMin})`, true);
      if (page.title.length > t.titleMax) add(page, 'title-too-long', 'medium', `Title is ${page.title.length} chars (max ${t.titleMax}) — will truncate in SERP`, true);
      const key = page.title.toLowerCase();
      titles.set(key, (titles.get(key) || []).concat(page.url));
    }

    // --- Meta description ---
    if (!page.metaDescription) add(page, 'missing-meta-description', 'high', 'No meta description', true);
    else {
      if (page.metaDescription.length < t.metaDescMin) add(page, 'meta-desc-too-short', 'low', `Meta description is ${page.metaDescription.length} chars`, true);
      if (page.metaDescription.length > t.metaDescMax) add(page, 'meta-desc-too-long', 'low', `Meta description is ${page.metaDescription.length} chars — will truncate`, true);
    }

    // --- Headings ---
    if (page.h1.length === 0) add(page, 'missing-h1', 'high', 'No H1 heading', true);
    if (page.h1.length > t.maxH1) add(page, 'multiple-h1', 'medium', `${page.h1.length} H1 tags found (should be ${t.maxH1})`);

    // --- Content depth ---
    if (page.wordCount < t.minWordCount) add(page, 'thin-content', 'medium', `Only ${page.wordCount} words (min ${t.minWordCount}) — thin content`);

    // --- Images / alt text ---
    const noAlt = page.images.filter((img) => img.src && (img.alt === null || img.alt === ''));
    if (noAlt.length) add(page, 'missing-alt-text', 'medium', `${noAlt.length} image(s) missing alt text`, true);

    // --- Canonical ---
    if (!page.canonical) add(page, 'missing-canonical', 'low', 'No canonical link');

    // --- Indexability ---
    if (page.robotsMeta && /noindex/i.test(page.robotsMeta)) add(page, 'noindex', 'high', 'Page is set to noindex — verify this is intentional');

    // --- Mobile ---
    if (!page.viewport) add(page, 'missing-viewport', 'high', 'No viewport meta — not mobile friendly');

    // --- Lang ---
    if (!page.lang) add(page, 'missing-lang', 'low', 'No <html lang> attribute');

    // --- Open Graph (social/sharing) ---
    if (!page.og.title || !page.og.image) add(page, 'missing-og', 'low', 'Missing Open Graph title/image — poor social previews', true);

    // --- Structured data (travel-specific) ---
    const parsed = parseLdJson(page.ldjson);
    const types = ldjsonTypes(parsed);
    if (parsed.some((p) => p.__invalid)) add(page, 'invalid-ldjson', 'medium', 'Invalid JSON-LD structured data');
    const hasTravelSchema = TRAVEL_SCHEMA.some((tp) => types.has(tp));
    if (!hasTravelSchema) add(page, 'missing-schema', 'high', 'No travel-relevant structured data (TouristTrip/Product/FAQ/TravelAgency)', true);

    // Cache parsed schema on the page for the fixer.
    page._schemaTypes = [...types];
  }

  // --- Cross-page: duplicate titles ---
  for (const [title, urls] of titles) {
    if (urls.length > 1) urls.forEach((u) => issues.push({ url: u, rule: 'duplicate-title', severity: 'medium', message: `Title duplicated across ${urls.length} pages`, fixable: true }));
  }

  // --- Site-wide: sitemap ---
  if (!crawlResult.sitemaps.length) issues.push({ url: crawlResult.site, rule: 'missing-sitemap', severity: 'high', message: 'No sitemap declared in robots.txt', fixable: true });

  return scoreAndGroup(issues, crawlResult);
}

function scoreAndGroup(issues, crawlResult) {
  const pageCount = Math.max(crawlResult.pages.length, 1);
  const penalty = issues.reduce((sum, i) => sum + (SEVERITY_WEIGHT[i.severity] || 0), 0);
  // Normalize penalty per page so big sites aren't unfairly crushed.
  const score = Math.max(0, Math.round(100 - (penalty / pageCount) * 4));

  const byRule = {};
  for (const i of issues) {
    byRule[i.rule] = byRule[i.rule] || { rule: i.rule, severity: i.severity, count: 0, fixable: i.fixable, pages: [] };
    byRule[i.rule].count++;
    if (byRule[i.rule].pages.length < 50) byRule[i.rule].pages.push(i.url);
  }

  return {
    site: crawlResult.site,
    auditedAt: new Date().toISOString(),
    score,
    pageCount,
    totalIssues: issues.length,
    summary: Object.values(byRule).sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] || b.count - a.count),
    issues,
  };
}
