#!/usr/bin/env node
// Guide India SEO Automode — CLI entrypoint.
// Commands: audit | fix | rank | report (report = audit + fix + rank + write)
import fs from 'node:fs';
import { crawl } from './crawler.js';
import { auditPages } from './audit.js';
import { generateFixes } from './ai.js';
import { trackRanks } from './rank.js';
import { writeReports } from './report.js';

function loadConfig() {
  const path = process.env.SEO_CONFIG || 'seo.config.json';
  if (!fs.existsSync(path)) {
    console.error(`Config not found: ${path}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

const log = (...a) => console.log(...a);

async function runAudit(config) {
  log(`🕷  Crawling ${config.site} …`);
  const crawlResult = await crawl(config, log);
  log(`📊 Auditing ${crawlResult.pages.length} pages …`);
  const audit = auditPages(crawlResult, config);
  log(`   Health score: ${audit.score}/100 · ${audit.totalIssues} issues`);
  return { crawlResult, audit };
}

async function main() {
  const cmd = process.argv[2] || 'report';
  const config = loadConfig();

  if (cmd === 'rank') {
    log('📈 Tracking keyword ranks …');
    await trackRanks(config, log);
    return;
  }

  const { crawlResult, audit } = await runAudit(config);

  if (cmd === 'audit') {
    writeReports(audit, null, null);
    log('✅ Wrote reports/scorecard.md');
    return;
  }

  // fix | report → also generate AI fixes
  log('🤖 Generating AI fixes …');
  const fixResult = await generateFixes(audit, crawlResult, config, log);

  let rankEntry = null;
  if (cmd === 'report') {
    log('📈 Tracking keyword ranks …');
    rankEntry = await trackRanks(config, log);
  }

  writeReports(audit, fixResult, rankEntry);
  log('✅ Done. See reports/scorecard.md and reports/scorecard.html');
  // Exit non-zero if score is critically low, so CI can flag regressions.
  if (audit.score < (config.minScore || 0)) process.exit(2);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
