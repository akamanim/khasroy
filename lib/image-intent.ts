export type ImageGenerationIntent = {
  kind: "image_generation";
  prompt: string;
  confidence: "explicit" | "visual_scene";
};

// JavaScript \b is based on ASCII-style word characters and is unreliable for
// Cyrillic command boundaries. Keep Russian and English command matching separate.
// Match stems rather than a tiny list of imperative forms so natural phrases like
// "можешь сгенерировать..." and "сможешь нарисовать..." are routed correctly.
const RU_EXPLICIT_GENERATOR = /(сгенерир|генерир|нарис|отрендер|визуализир|изобраз)/iu;
const EN_EXPLICIT_GENERATOR = /\b(generate|render|draw|visualize|illustrate)\b/iu;
const IMAGE_NOUN = /(фото|фотк|фотограф|картин|изображен|иллюстрац|портрет|аватар|постер|обложк|логотип|рендер|image|photo|picture|portrait|poster|cover|logo)/iu;
const CREATE_INTENT = /(создай|сделай|сделать|хочу|покажи|поставь|помести|размести|нарис|отрендер|\bcreate\b|\bmake\b|\bshow\b|\bplace\b|\bdraw\b|\brender\b)/iu;
const VISUAL_SCENE = /(на фоне|рядом с|за рул[её]м|сидит|стоит|летит|едет|держит|в горах|у моря|на море|у океана|на берегу|на пляже|на парковке|на трассе|на дороге|в городе|в лесу|в студии|реалистич|фотореалист|кинематограф|cinematic|background|next to|behind the wheel|mountains?|ocean|beach|parking|road|city|forest|studio|photoreal)/iu;
const VISUAL_WISH = /(хочу\s+(?:фото|фотк|картин|изображ)|покажи\s+как\s+(?:это\s+)?(?:будет|будет\s+выглядеть|выглядит)|как\s+бы\s+(?:это\s+)?выглядел)/iu;
const META_OUTPUT = /(парол|\bpassword\b|код|\bcode\b|json|xml|sql|таблиц|список|текст|письм|сообщен|промпт|\bprompt\b|инструкц|описан|назван|иде[яи]|скрипт|\bscript\b|регуляр|\bregex\b)/iu;
const CAPABILITY_QUESTION = /^(?:(?:а\s+)?ты\s+)?(?:умеешь|умеешь\s+ли|способен(?:\s+ли)?|можешь\s+ли\s+ты)\b.*(?:генерир|нарис|рендер|изображ|фото)|^do\s+you\s+(?:know\s+how\s+to\s+)?(?:generate|draw|render)\b/iu;

function metaOutputComesBeforeImage(prompt: string) {
  const meta = META_OUTPUT.exec(prompt);
  if (!meta) return false;
  const image = IMAGE_NOUN.exec(prompt);
  return !image || (meta.index ?? 0) < (image.index ?? Number.MAX_SAFE_INTEGER);
}

export function detectImageGenerationIntent(text: string): ImageGenerationIntent | null {
  const prompt = text.replace(/\s+/gu, " ").trim().slice(0, 4000);
  if (!prompt) return null;

  // Capability questions should stay in the conversational brain rather than
  // spending image quota. Concrete requests such as "можешь сгенерировать кота"
  // still pass through because they do not match this ability-question pattern.
  if (CAPABILITY_QUESTION.test(prompt)) return null;

  // "Сгенерируй промпт для фото" asks for text, while
  // "Сгенерируй изображение по этому промпту" asks for an image.
  if (metaOutputComesBeforeImage(prompt)) return null;

  if (RU_EXPLICIT_GENERATOR.test(prompt) || EN_EXPLICIT_GENERATOR.test(prompt)) {
    return { kind: "image_generation", prompt, confidence: "explicit" };
  }

  if (VISUAL_WISH.test(prompt)) {
    return { kind: "image_generation", prompt, confidence: "visual_scene" };
  }

  if (CREATE_INTENT.test(prompt) && (IMAGE_NOUN.test(prompt) || VISUAL_SCENE.test(prompt))) {
    return { kind: "image_generation", prompt, confidence: "visual_scene" };
  }

  return null;
}

export function looksLikeImageGenerationRequest(text: string) {
  return detectImageGenerationIntent(text) !== null;
}
