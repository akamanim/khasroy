const LABELS = ["Subject", "Scene", "Composition", "Lighting", "Camera", "Style", "Constraints"];

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value) {
  return normalize(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  return normalizeForMatch(value)
    .split(" ")
    .filter((token) => token.length >= 3);
}

export function parseStructuredImagePrompt(prompt) {
  const source = String(prompt ?? "");
  const result = {};
  const labelPattern = new RegExp(`(?:^|\\n)(${LABELS.join("|")}):\\s*`, "g");
  const matches = [...source.matchAll(labelPattern)];

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const label = match[1];
    const start = match.index + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : source.length;
    result[label] = normalize(source.slice(start, end));
  }

  return result;
}

export function evaluateImagePromptContract({ originalRequest, compiledPrompt, required = {} }) {
  const original = normalize(originalRequest);
  const sections = parseStructuredImagePrompt(compiledPrompt);
  const failures = [];

  if (!original) failures.push("original_request_missing");
  if (!sections.Subject) failures.push("subject_missing");

  const compiledNormalized = normalizeForMatch(compiledPrompt);
  const originalTokens = [...new Set(tokens(original))];
  const preservedTokens = originalTokens.filter((token) => compiledNormalized.includes(token));
  const semanticCoverage = originalTokens.length === 0 ? 1 : preservedTokens.length / originalTokens.length;

  if (originalTokens.length >= 3 && semanticCoverage < 0.8) {
    failures.push("original_request_drift");
  }

  for (const label of LABELS) {
    const expected = normalize(required[label]);
    if (!expected) continue;
    const actual = normalize(sections[label]);
    if (!actual) {
      failures.push(`${label.toLowerCase()}_missing`);
      continue;
    }
    const expectedTokens = [...new Set(tokens(expected))];
    const actualNormalized = normalizeForMatch(actual);
    const matched = expectedTokens.filter((token) => actualNormalized.includes(token));
    const coverage = expectedTokens.length === 0 ? 1 : matched.length / expectedTokens.length;
    if (coverage < 0.8) failures.push(`${label.toLowerCase()}_drift`);
  }

  const score = Math.max(0, Math.round((semanticCoverage * 70 + (failures.length === 0 ? 30 : 0)) * 100) / 100);

  return {
    ok: failures.length === 0,
    score,
    semanticCoverage: Math.round(semanticCoverage * 1000) / 1000,
    preservedTokenCount: preservedTokens.length,
    originalTokenCount: originalTokens.length,
    failures,
    sections,
  };
}
