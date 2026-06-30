// Lightweight, polite, concurrent crawler. Native fetch + cheerio.
import * as cheerio from 'cheerio';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeUrl(href, base) {
  try {
    const u = new URL(href, base);
    u.hash = '';
    // drop common tracking params
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((p) =>
      u.searchParams.delete(p)
    );
    return u.toString();
  } catch {
    return null;
  }
}

function sameHost(url, rootUrl) {
  try {
    return new URL(url).host.replace(/^www\./, '') === new URL(rootUrl).host.replace(/^www\./, '');
  } catch {
    return false;
  }
}

async function fetchRobots(rootUrl, ua) {
  try {
    const res = await fetch(new URL('/robots.txt', rootUrl), { headers: { 'user-agent': ua } });
    if (!res.ok) return { disallow: [], sitemaps: [] };
    const text = await res.text();
    const disallow = [];
    const sitemaps = [];
    let relevant = false;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      const [k, ...rest] = line.split(':');
      const key = (k || '').toLowerCase();
      const val = rest.join(':').trim();
      if (key === 'user-agent') relevant = val === '*' || ua.toLowerCase().includes(val.toLowerCase());
      if (key === 'disallow' && relevant && val) disallow.push(val);
      if (key === 'sitemap') sitemaps.push(val);
    }
    return { disallow, sitemaps };
  } catch {
    return { disallow: [], sitemaps: [] };
  }
}

function blockedByRobots(url, disallow) {
  try {
    const path = new URL(url).pathname;
    return disallow.some((rule) => path.startsWith(rule));
  } catch {
    return false;
  }
}

function extractPage(html, url) {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
      links.push(href);
    }
  });
  const images = [];
  $('img').each((_, el) => {
    images.push({ src: $(el).attr('src') || '', alt: $(el).attr('alt') ?? null });
  });
  const ldjson = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    ldjson.push($(el).contents().text());
  });

  return {
    url,
    title: $('head > title').first().text().trim() || null,
    metaDescription: $('meta[name="description"]').attr('content')?.trim() ?? null,
    canonical: $('link[rel="canonical"]').attr('href')?.trim() ?? null,
    robotsMeta: $('meta[name="robots"]').attr('content')?.trim() ?? null,
    h1: $('h1').map((_, el) => $(el).text().trim()).get(),
    h2: $('h2').map((_, el) => $(el).text().trim()).get(),
    og: {
      title: $('meta[property="og:title"]').attr('content') ?? null,
      description: $('meta[property="og:description"]').attr('content') ?? null,
      image: $('meta[property="og:image"]').attr('content') ?? null,
    },
    viewport: $('meta[name="viewport"]').attr('content') ?? null,
    lang: $('html').attr('lang') ?? null,
    wordCount: text ? text.split(' ').length : 0,
    images,
    ldjson,
    links,
    rawTextSnippet: text.slice(0, 4000),
  };
}

export async function crawl(config, log = console.log) {
  const { site, crawl: c } = config;
  const ua = c.userAgent;
  const robots = c.respectRobots ? await fetchRobots(site, ua) : { disallow: [], sitemaps: [] };

  const queue = [normalizeUrl(site, site)];
  const seen = new Set(queue);
  const pages = [];
  const errors = [];

  while (queue.length && pages.length < c.maxPages) {
    const batch = queue.splice(0, c.concurrency);
    await Promise.all(
      batch.map(async (url) => {
        if (c.respectRobots && blockedByRobots(url, robots.disallow)) return;
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), c.timeoutMs);
          const res = await fetch(url, { headers: { 'user-agent': ua }, redirect: 'follow', signal: ctrl.signal });
          clearTimeout(t);
          const status = res.status;
          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('text/html')) return;
          const html = await res.text();
          const page = extractPage(html, url);
          page.status = status;
          pages.push(page);
          log(`  crawled [${status}] ${url} (${pages.length}/${c.maxPages})`);

          for (const raw of page.links) {
            const next = normalizeUrl(raw, url);
            if (next && sameHost(next, site) && !seen.has(next)) {
              seen.add(next);
              if (pages.length + queue.length < c.maxPages) queue.push(next);
            }
          }
        } catch (e) {
          errors.push({ url, error: String(e.message || e) });
        }
      })
    );
    if (c.requestDelayMs) await sleep(c.requestDelayMs);
  }

  return { site, crawledAt: new Date().toISOString(), pages, errors, sitemaps: robots.sitemaps };
}
