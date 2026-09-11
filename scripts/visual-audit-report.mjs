#!/usr/bin/env node
import fs from 'node:fs';

const paths = process.argv.slice(2);
if (paths.length < 2) {
  console.error('Usage: node scripts/visual-audit-report.mjs <viewport-report.json> <viewport-report.json> [...]');
  process.exit(2);
}

const reports = paths.map((path) => JSON.parse(fs.readFileSync(path, 'utf8')));
const severityRank = { low: 1, medium: 2, high: 3 };
const typeMatrix = new Map();
let highestSeverity = 'none';

for (const report of reports) {
  const counts = {};
  for (const finding of report.findings || []) {
    counts[finding.type] = (counts[finding.type] || 0) + 1;
    if ((severityRank[finding.severity] || 0) > (severityRank[highestSeverity] || 0)) highestSeverity = finding.severity;
  }
  for (const type of new Set([...typeMatrix.keys(), ...Object.keys(counts)])) {
    if (!typeMatrix.has(type)) typeMatrix.set(type, {});
    typeMatrix.get(type)[report.viewportWidth] = counts[type] || 0;
  }
}

const viewports = reports.map((report) => report.viewportWidth);
for (const counts of typeMatrix.values()) {
  for (const viewport of viewports) {
    if (counts[viewport] === undefined) counts[viewport] = 0;
  }
}

const differences = [];
for (const [type, counts] of typeMatrix.entries()) {
  const values = Object.values(counts);
  if (Math.min(...values) !== Math.max(...values)) differences.push({ type, countsByViewport: counts });
}

const scores = reports.map((report) => Number(report.score) || 0);
const output = {
  skill: 'multi_viewport_visual_audit_report_v1',
  viewportsTested: viewports,
  viewportCount: reports.length,
  clean: reports.every((report) => (report.findingsCount || 0) === 0),
  highestSeverity,
  lowestScore: Math.min(...scores),
  averageScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
  desktopMobileDifferences: differences,
  byViewport: reports.map((report) => ({
    viewportWidth: report.viewportWidth,
    findingsCount: report.findingsCount,
    score: report.score,
    conversionScore: report.conversion?.score ?? null,
    findingTypes: [...new Set((report.findings || []).map((finding) => finding.type))],
  })),
};

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
