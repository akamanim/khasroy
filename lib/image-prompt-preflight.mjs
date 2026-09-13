function normalize(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function normalizedTokens(value) {
  return normalize(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length >= 3 || /\d/u.test(token));
}

export function evaluateImagePromptPreflight({ originalRequest, compiledPrompt, minCoverage = 0.8 }) {
  const original = normalize(originalRequest);
  const compiled = normalize(compiledPrompt);
  const failures = [];

  if (!original) failures.push("original_request_missing");
  if (!compiled) failures.push("compiled_prompt_missing");

  const originalTokens = [...new Set(normalizedTokens(original))];
  const compiledSet = new Set(normalizedTokens(compiled));
  const preserved = originalTokens.filter((token) => compiledSet.has(token));
  const coverage = originalTokens.length === 0 ? 0 : preserved.length / originalTokens.length;

  if (originalTokens.length >= 3 && coverage < minCoverage) {
    failures.push("original_request_drift");
  }

  return {
    ok: failures.length === 0,
    coverage: Math.round(coverage * 1000) / 1000,
    preservedTokenCount: preserved.length,
    originalTokenCount: originalTokens.length,
    failures,
  };
}

export function assertImagePromptPreflight(args) {
  const result = evaluateImagePromptPreflight(args);
  if (!result.ok) {
    throw new Error(`image_prompt_preflight_failed:${result.failures.join(",")}`);
  }
  return result;
}
