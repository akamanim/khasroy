#!/usr/bin/env node
import fs from "node:fs";

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: node scripts/mobile-audit-report.mjs <result.json> [...]");
  process.exit(2);
}

const reports = args.map((path) => JSON.parse(fs.readFileSync(path, "utf8")));

function severityFor(finding) {
  if (finding.type === "document-horizontal-overflow") return "high";
  if (finding.type === "element-horizontal-overflow") return "high";
  if (finding.type === "undersized-pointer-target") return "medium";
  return "low";
}

const byType = {};
const byViewport = [];
let totalFindings = 0;
let highest = "none";
const rank = { none: 0, low: 1, medium: 2, high: 3 };

for (const report of reports) {
  const findings = Array.isArray(report.findings) ? report.findings : [];
  totalFindings += findings.length;

  let viewportHighest = "none";
  for (const finding of findings) {
    const severity = severityFor(finding);
    byType[finding.type] = (byType[finding.type] || 0) + 1;
    if (rank[severity] > rank[viewportHighest]) viewportHighest = severity;
    if (rank[severity] > rank[highest]) highest = severity;
  }

  byViewport.push({
    viewportWidth: report.viewportWidth,
    findingsCount: findings.length,
    highestSeverity: viewportHighest,
    types: [...new Set(findings.map((f) => f.type))],
  });
}

const output = {
  skill: "multi_viewport_mobile_audit_report",
  viewportsTested: reports.map((r) => r.viewportWidth),
  viewportCount: reports.length,
  totalFindings,
  highestSeverity: highest,
  clean: totalFindings === 0,
  findingsByType: byType,
  byViewport,
  recommendation:
    totalFindings === 0
      ? "No audited mobile layout risks were detected in the supplied viewport runs."
      : "Fix high-severity horizontal overflow first, then undersized pointer targets, and rerun all audited viewports.",
};

process.stdout.write(JSON.stringify(output, null, 2) + "\n");
