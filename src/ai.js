// AI fix generator. Uses Claude to write SEO assets that actually convert for a
// travel/tours business: titles, meta descriptions, alt text, and JSON-LD schema.
import Anthropic from '@anthropic-ai/sdk';

// Which rules we can auto-generate a concrete fix for, and how to prompt for them.
const FIXABLE = new Set([
  'missing-title',
  'title-too-short',
  'title-too-long',
  'duplicate-title',
  'missing-meta-description',
  'meta-desc-too-short',
  'meta-desc-too-long',
  'missing-h1',
  'missing-alt-text',
  'missing-schema',
  'missing-og',
]);

function systemPrompt(config) {
  return `You are an expert technical + on-page SEO specialist for "${config.businessName}", a ${config.businessType} in the niche: ${config.niche}.
Locale: ${config.locale}. You write SEO assets that rank AND drive bookings.

Rules:
- Titles: ${config.thresholds.titleMin}-${config.thresholds.titleMax} chars, lead with the primary keyword, include the brand only if it fits.
- Meta descriptions: ${config.thresholds.metaDescMin}-${config.thresholds.metaDescMax} chars, benefit-led, with a soft CTA (e.g. "Book your...", "Explore...").
- Use natural Indian-travel search language (e.g. "tour package", "itinerary", "guided tour", destination names).
- JSON-LD must be valid schema.org and match the page's actual content (TouristTrip / Product+Offer for tour pages, TravelAgency for home/contact, FAQPage where Q&A exists, BreadcrumbList for nested pages).
- Never invent prices, dates, or reviews you cannot infer from the page content. Omit unknown fields rather than fabricate.
Return ONLY the requested JSON. No prose, no markdown fences.`;
}

function buildTask(issuesForPage, page) {
  const rules = [...new Set(issuesForPage.map((i) => i.rule))].filter((r) => FIXABLE.has(r));
  return {
    url: page.url,
    currentTitle: page.title,
    currentMeta: page.metaDescription,
    currentH1: page.h1,
    existingSchemaTypes: page._schemaTypes || [],
    imagesNeedingAlt: page.images.filter((i) => i.src && !i.alt).slice(0, 15).map((i) => i.src),
    pageContentSnippet: page.rawTextSnippet,
    needs: rules,
  };
}

const OUTPUT_SHAPE = `Respond with a single JSON object:
{
  "title": "<new title or null>",
  "metaDescription": "<new meta description or null>",
  "h1": "<suggested H1 or null>",
  "ogTitle": "<og:title or null>",
  "ogDescription": "<og:description or null>",
  "altText": { "<image-src>": "<descriptive alt>", ... },   // only for images that needed it
  "jsonLd": <a valid schema.org JSON-LD object, or null>
}
Set a field to null if it is not needed for this page.`;

export async function generateFixes(auditResult, crawlResult, config, log = console.log) {
  if (!config.ai?.enabled) {
    log('  AI fixes disabled in config.');
    return { fixes: [], skipped: 'ai-disabled' };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log('  ⚠ ANTHROPIC_API_KEY not set — skipping AI fix generation.');
    return { fixes: [], skipped: 'no-api-key' };
  }

  const client = new Anthropic({ apiKey });
  const pageByUrl = new Map(crawlResult.pages.map((p) => [p.url, p]));

  // Group fixable issues per page, prioritizing worst-scoring pages.
  const byPage = new Map();
  for (const issue of auditResult.issues) {
    if (!FIXABLE.has(issue.rule)) continue;
    if (!pageByUrl.has(issue.url)) continue;
    byPage.set(issue.url, (byPage.get(issue.url) || []).concat(issue));
  }

  const targets = [...byPage.entries()].slice(0, config.ai.maxFixesPerRun);
  const fixes = [];
  const sys = systemPrompt(config);

  for (const [url, issues] of targets) {
    const page = pageByUrl.get(url);
    const task = buildTask(issues, page);
    if (!task.needs.length) continue;
    try {
      const res = await client.messages.create({
        model: config.ai.model,
        max_tokens: 1500,
        system: sys,
        messages: [
          {
            role: 'user',
            content: `Generate SEO fixes for this page.\n\n${OUTPUT_SHAPE}\n\nPAGE DATA:\n${JSON.stringify(task, null, 2)}`,
          },
        ],
      });
      const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
      const json = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
      fixes.push({ url, addressed: task.needs, fix: json });
      log(`  ✓ generated fixes for ${url} (${task.needs.join(', ')})`);
    } catch (e) {
      log(`  ✗ fix failed for ${url}: ${e.message}`);
    }
  }

  return { fixes, generatedAt: new Date().toISOString() };
}
