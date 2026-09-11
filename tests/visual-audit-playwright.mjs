#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const playwrightPath = process.env.PLAYWRIGHT_CORE_PATH;
const playwright = playwrightPath
  ? await import(pathToFileURL(path.resolve(repoRoot, playwrightPath)).href)
  : await import('playwright-core');
const { chromium } = playwright;
const executablePath = process.env.CHROME_PATH;

assert.ok(executablePath, 'CHROME_PATH must point to a Chromium/Chrome executable');

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const fixtureUrl = pathToFileURL(path.join(repoRoot, 'examples/site-audit/visual-audit-fixture.html')).href;

async function run(mode, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.goto(`${fixtureUrl}?mode=${mode}`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.KhasroyVisualAudit === 'function');
    return await page.evaluate(() => window.KhasroyVisualAudit());
  } finally {
    await page.close();
  }
}

try {
  const brokenMobile = await run('broken', 375, 812);
  const brokenDesktop = await run('broken', 1440, 900);
  const fixedMobile = await run('fixed', 375, 812);
  const fixedDesktop = await run('fixed', 1440, 900);

  const mobileTypes = new Set(brokenMobile.findings.map((finding) => finding.type));
  for (const expected of [
    'typography-hierarchy',
    'spacing-inconsistency',
    'primary-cta-not-visible-above-fold',
    'low-contrast-text',
    'distorted-image',
    'inconsistent-button-radius',
    'inconsistent-alignment',
    'weak-conversion-structure',
  ]) {
    assert.ok(mobileTypes.has(expected), `broken mobile fixture must detect ${expected}`);
  }

  const desktopTypes = new Set(brokenDesktop.findings.map((finding) => finding.type));
  assert.ok(desktopTypes.has('excessive-text-width'), 'broken desktop fixture must detect excessive-text-width');
  assert.ok(brokenMobile.findingsCount >= 8, 'broken mobile fixture should have multiple visual findings');
  assert.ok(brokenDesktop.findingsCount >= 8, 'broken desktop fixture should have multiple visual findings');

  assert.equal(fixedMobile.findingsCount, 0, `fixed mobile fixture should be clean: ${JSON.stringify(fixedMobile.findings)}`);
  assert.equal(fixedDesktop.findingsCount, 0, `fixed desktop fixture should be clean: ${JSON.stringify(fixedDesktop.findings)}`);
  assert.equal(fixedMobile.score, 100);
  assert.equal(fixedDesktop.score, 100);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'khasroy-visual-audit-'));
  const brokenMobilePath = path.join(tempDir, 'broken-mobile.json');
  const brokenDesktopPath = path.join(tempDir, 'broken-desktop.json');
  const fixedMobilePath = path.join(tempDir, 'fixed-mobile.json');
  const fixedDesktopPath = path.join(tempDir, 'fixed-desktop.json');
  fs.writeFileSync(brokenMobilePath, JSON.stringify(brokenMobile));
  fs.writeFileSync(brokenDesktopPath, JSON.stringify(brokenDesktop));
  fs.writeFileSync(fixedMobilePath, JSON.stringify(fixedMobile));
  fs.writeFileSync(fixedDesktopPath, JSON.stringify(fixedDesktop));

  const brokenAggregate = JSON.parse(execFileSync('node', [
    path.join(repoRoot, 'scripts/visual-audit-report.mjs'),
    brokenMobilePath,
    brokenDesktopPath,
  ], { encoding: 'utf8' }));
  const fixedAggregate = JSON.parse(execFileSync('node', [
    path.join(repoRoot, 'scripts/visual-audit-report.mjs'),
    fixedMobilePath,
    fixedDesktopPath,
  ], { encoding: 'utf8' }));

  assert.equal(brokenAggregate.clean, false);
  assert.ok(brokenAggregate.desktopMobileDifferences.length >= 1, 'broken reports must expose desktop/mobile differences');
  assert.equal(fixedAggregate.clean, true);
  assert.equal(fixedAggregate.desktopMobileDifferences.length, 0);

  process.stdout.write(JSON.stringify({
    ok: true,
    brokenMobile: { findingsCount: brokenMobile.findingsCount, score: brokenMobile.score },
    brokenDesktop: { findingsCount: brokenDesktop.findingsCount, score: brokenDesktop.score },
    fixedMobile: { findingsCount: fixedMobile.findingsCount, score: fixedMobile.score },
    fixedDesktop: { findingsCount: fixedDesktop.findingsCount, score: fixedDesktop.score },
    desktopMobileDifferences: brokenAggregate.desktopMobileDifferences,
  }, null, 2) + '\n');
} finally {
  await browser.close();
}
