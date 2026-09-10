import fs from 'node:fs';

const file = process.argv[2] ?? 'examples/site-audit/mobile-audit-fixture.html';
const html = fs.readFileSync(file, 'utf8');
const findings = [];

for (const m of html.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
  const [, selector, body] = m;
  const width = body.match(/(?:^|;)\s*width\s*:\s*(\d+)px/i);
  const height = body.match(/(?:^|;)\s*height\s*:\s*(\d+)px/i);
  if (width && Number(width[1]) > 320) findings.push({rule:'fixed-width-overflow-risk',selector:`.${selector}`,value:Number(width[1])});
  if (width && height && Number(width[1]) < 24 && Number(height[1]) < 24) findings.push({rule:'undersized-pointer-target-risk',selector:`.${selector}`,value:`${width[1]}x${height[1]}`});
}

console.log(JSON.stringify({file, findings}, null, 2));
if (!findings.some(x=>x.rule==='fixed-width-overflow-risk') || !findings.some(x=>x.rule==='undersized-pointer-target-risk')) process.exitCode=1;
