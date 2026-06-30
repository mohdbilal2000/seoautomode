# 🧭 Guide India SEO Automode

A 24/7, mostly-hands-off SEO engine for **guideindiatours.com**. It applies the
80/20 rule: automate the ~20% of on-page/technical SEO work that drives ~80% of
the results, and let Claude write the actual fixes.

It does **not** reinvent crawling — it ships a lean crawler and adds the part
that's actually valuable: **AI-generated, travel-aware fixes** + a **0–100 health
score that's tracked over time** + a **free 24/7 scheduler** (GitHub Actions).

## What it does each run

1. **Crawl** the site (polite, concurrent, robots-aware).
2. **Audit** every page against on-page + technical rules:
   - titles, meta descriptions, H1s, duplicate titles
   - thin content, image alt text, canonical, indexability, viewport, `lang`
   - Open Graph, sitemap presence
   - **travel-specific structured data** (TouristTrip / Product+Offer / FAQPage / TravelAgency / BreadcrumbList)
3. **Score** the site 0–100 and diff against the previous run (what got fixed, what regressed).
4. **Generate fixes with Claude** — ready-to-paste titles, meta descriptions, alt
   text, and valid JSON-LD schema, written in natural India-travel search language.
5. **Track keyword ranks** over time (optional, via SerpAPI).
6. **Report**: `reports/scorecard.md` + `scorecard.html` + JSON history.

## Quick start

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...      # for AI fixes
export SERPAPI_KEY=...                    # optional, for rank tracking
node src/cli.js report                    # full run
```

Other commands:

```bash
node src/cli.js audit    # crawl + score only (no AI, no API key needed)
node src/cli.js fix      # crawl + score + AI fixes
node src/cli.js rank     # keyword positions only
```

Output lands in `reports/`. The AI fixes in `reports/fixes.json` are
**suggestions to review**, not auto-applied to your live site — safe by design.

## 24/7 automation

`.github/workflows/seo-automode.yml` runs the full pipeline **nightly** and opens
a PR with the fresh scorecard + suggested fixes. No server, no cost beyond
Actions minutes. To enable:

1. Push this repo to GitHub.
2. Add repo secrets: `ANTHROPIC_API_KEY` (and optionally `SERPAPI_KEY`).
3. Done — it runs every night at 02:00 UTC, or trigger manually from the Actions tab.

## Configuration

Everything lives in `seo.config.json` — site URL, crawl limits, score
thresholds, tracked keywords, and the Claude model. Tune it to taste.

## How to use the output

- **Titles / meta / alt / OG** → paste into your CMS (WordPress Yoast/RankMath, etc.).
- **JSON-LD** → drop into the page `<head>` (or a schema plugin). Validate at
  [search.google.com/test/rich-results](https://search.google.com/test/rich-results).
- **Score trend** → watch it climb; investigate any "New since last run" issues.

## Why this stack

The crawl/audit layer is a commodity (Screaming Frog, SEOnaut, site-audit-seo all
do it free). The leverage is in **generating the fixes** and **running unattended
forever** — that's what this adds.
