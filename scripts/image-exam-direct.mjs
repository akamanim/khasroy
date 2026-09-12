import fs from 'node:fs';

const IMAGE_ENDPOINT = 'https://ai-gateway.vercel.sh/v1/images/generations';
const CHAT_ENDPOINT = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const PROMPT = 'Сделай реалистичное фото Changan Q05 на горной дороге, на фоне высоких заснеженных гор';
const MODELS = [
  'bfl/flux-2-pro',
  'openai/gpt-image-2',
  'xai/grok-imagine-image',
  'google/imagen-4.0-ultra-generate-001',
];
const THRESHOLDS = { subjectMatch: 72, sceneMatch: 62, requestMatch: 72, overall: 70 };

function clamp(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function parseJsonObject(value) {
  const cleaned = String(value || '').trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/u);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function compiledPrompt(repair = '') {
  const base = [
    'Create a photorealistic image that exactly satisfies the owner request.',
    `OWNER REQUEST: ${PROMPT}`,
    'The main subject must be a Changan Q05 vehicle, clearly visible and recognizable as that requested model.',
    'Place it on a real winding mountain road with tall snow-capped mountains clearly visible in the background.',
    'Natural automotive photography, realistic proportions, believable road and mountain geometry, no unrelated rooms, furniture, people, text or watermark.',
  ];
  if (repair) base.splice(2, 0, `MANDATORY CORRECTION FROM THE VISUAL EXAMINER: ${repair}`);
  return base.join(' ');
}

async function generateImage(token, prompt, avoidModel = '') {
  const errors = [];
  for (const model of MODELS.filter((m) => m !== avoidModel)) {
    try {
      console.log(`GENERATION_TRY model=${model}`);
      const response = await fetch(IMAGE_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, n: 1, response_format: 'b64_json' }),
        signal: AbortSignal.timeout(45000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error?.message || payload?.error?.code || `HTTP ${response.status}`;
        errors.push(`${model}:${response.status}:${message}`);
        console.log(`GENERATION_SKIP model=${model} status=${response.status} reason=${String(message).slice(0,180)}`);
        continue;
      }
      const item = payload?.data?.[0];
      if (item?.b64_json) {
        return { model: payload?.model || model, requestedModel: model, mediaType: 'image/png', bytes: Buffer.from(item.b64_json, 'base64') };
      }
      if (item?.url) {
        const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(15000) });
        if (!imageResponse.ok) throw new Error(`image_url_http_${imageResponse.status}`);
        const mediaType = (imageResponse.headers.get('content-type') || 'image/png').split(';')[0];
        return { model: payload?.model || model, requestedModel: model, mediaType, bytes: Buffer.from(await imageResponse.arrayBuffer()) };
      }
      errors.push(`${model}:no_image`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${model}:${message}`);
      console.log(`GENERATION_SKIP model=${model} reason=${message.slice(0,180)}`);
    }
  }
  throw new Error(`all_models_failed=${errors.join(' | ').slice(0,900)}`);
}

async function verifyImage(token, image) {
  const dataUrl = `data:${image.mediaType};base64,${image.bytes.toString('base64')}`;
  const response = await fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-5.6-sol',
      models: ['google/gemini-3.6-flash', 'anthropic/claude-sonnet-5'],
      response_format: { type: 'json_object' },
      reasoning_effort: 'low',
      temperature: 0.05,
      max_completion_tokens: 650,
      stream: false,
      messages: [
        {
          role: 'system',
          content: 'You are Khasroy Visual Examiner. Judge only visible image content against the owner request. Be strict. Return JSON only.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `OWNER REQUEST: ${PROMPT}\nReturn JSON with subjectMatch, sceneMatch, requestMatch, overall (0-100), criticalMismatch boolean, visibleFacts array, mismatches array, repairPrompt string. criticalMismatch=true when the Changan Q05 is absent/wrong or the requested mountain-road environment is fundamentally wrong.`,
            },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => null);
  const content = payload?.choices?.[0]?.message?.content || '';
  if (!response.ok || !content) {
    throw new Error(payload?.error?.message || `verifier_http_${response.status}`);
  }
  const parsed = parseJsonObject(content);
  if (!parsed) throw new Error('verifier_invalid_json');
  const audit = {
    subjectMatch: clamp(parsed.subjectMatch),
    sceneMatch: clamp(parsed.sceneMatch),
    requestMatch: clamp(parsed.requestMatch),
    overall: clamp(parsed.overall),
    criticalMismatch: parsed.criticalMismatch === true,
    visibleFacts: Array.isArray(parsed.visibleFacts) ? parsed.visibleFacts.slice(0, 6) : [],
    mismatches: Array.isArray(parsed.mismatches) ? parsed.mismatches.slice(0, 6) : [],
    repairPrompt: typeof parsed.repairPrompt === 'string' ? parsed.repairPrompt.slice(0, 500) : '',
    verifierModel: payload?.model || 'openai/gpt-5.6-sol',
  };
  audit.passed = !audit.criticalMismatch &&
    audit.subjectMatch >= THRESHOLDS.subjectMatch &&
    audit.sceneMatch >= THRESHOLDS.sceneMatch &&
    audit.requestMatch >= THRESHOLDS.requestMatch &&
    audit.overall >= THRESHOLDS.overall;
  return audit;
}

async function main() {
  const token = process.env.VERCEL_OIDC_TOKEN?.trim();
  if (!token) throw new Error('VERCEL_OIDC_TOKEN missing');
  fs.mkdirSync('exam-output', { recursive: true });

  const attempts = [];
  let repair = '';
  let avoidModel = '';
  let final = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    console.log(`EXAM_ATTEMPT ${attempt}`);
    const image = await generateImage(token, compiledPrompt(repair), avoidModel);
    const ext = image.mediaType.includes('jpeg') || image.mediaType.includes('jpg') ? 'jpg' : 'png';
    fs.writeFileSync(`exam-output/attempt-${attempt}.${ext}`, image.bytes);
    const audit = await verifyImage(token, image);
    attempts.push({ attempt, generationModel: image.model, requestedModel: image.requestedModel, audit });
    console.log(`AUDIT attempt=${attempt} subject=${audit.subjectMatch} scene=${audit.sceneMatch} request=${audit.requestMatch} overall=${audit.overall} critical=${audit.criticalMismatch} passed=${audit.passed}`);
    if (audit.passed) {
      final = { image, audit, attempt };
      break;
    }
    repair = audit.repairPrompt || audit.mismatches.join('; ');
    avoidModel = image.requestedModel;
    final = { image, audit, attempt };
  }

  const result = {
    prompt: PROMPT,
    passed: Boolean(final?.audit?.passed),
    attempts,
    final: final ? {
      attempt: final.attempt,
      generationModel: final.image.model,
      requestedModel: final.image.requestedModel,
      audit: final.audit,
    } : null,
    finishedAt: new Date().toISOString(),
  };
  fs.writeFileSync('exam-output/result.json', JSON.stringify(result, null, 2));
  console.log(`EXAM_RESULT ${JSON.stringify({ passed: result.passed, final: result.final })}`);
}

main().catch((error) => {
  console.error(`EXAM_TECHNICAL_FAILURE ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
});
