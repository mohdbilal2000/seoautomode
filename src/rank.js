// Lightweight keyword position tracking over time.
// Uses SerpAPI if SERPAPI_KEY is set; otherwise records "not-checked" so the
// history file stays consistent and the report can still render.
import fs from 'node:fs';
import path from 'node:path';

const HISTORY = path.join('reports', 'rank-history.json');

async function serpApiPosition(keyword, domain, key, locale) {
  const params = new URLSearchParams({
    engine: 'google',
    q: keyword,
    num: '100',
    api_key: key,
    gl: locale?.split('-')[1]?.toLowerCase() || 'in',
    hl: locale?.split('-')[0] || 'en',
  });
  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!res.ok) throw new Error(`SerpAPI ${res.status}`);
  const data = await res.json();
  const host = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  const hit = (data.organic_results || []).find((r) => (r.link || '').replace(/^www\./, '').includes(host));
  return hit ? hit.position : null;
}

export async function trackRanks(config, log = console.log) {
  const key = process.env.SERPAPI_KEY;
  const results = [];
  for (const kw of config.trackKeywords || []) {
    if (!key) {
      results.push({ keyword: kw, position: null, note: 'no SERPAPI_KEY' });
      continue;
    }
    try {
      const position = await serpApiPosition(kw, config.site, key, config.locale);
      results.push({ keyword: kw, position });
      log(`  "${kw}" → ${position ? `#${position}` : 'not in top 100'}`);
    } catch (e) {
      results.push({ keyword: kw, position: null, note: e.message });
    }
  }

  const entry = { date: new Date().toISOString(), results };
  let history = [];
  if (fs.existsSync(HISTORY)) {
    try { history = JSON.parse(fs.readFileSync(HISTORY, 'utf8')); } catch {}
  }
  history.push(entry);
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(HISTORY, JSON.stringify(history, null, 2));
  return entry;
}
