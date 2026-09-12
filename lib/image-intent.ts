export type ImageGenerationIntent = {
  kind: "image_generation";
  prompt: string;
  confidence: "explicit" | "visual_scene";
};

// JavaScript \b is based on ASCII-style word characters and is unreliable for
// Cyrillic command boundaries. Keep Russian and English command matching separate.
const RU_EXPLICIT_GENERATOR = /(сгенерируй|генерируй|нарисуй|отрендери|визуализируй|создай\s+(?:фото|фотографию|картинку|изображение|иллюстрацию|портрет|аватар|постер|обложку|логотип))/iu;
const EN_EXPLICIT_GENERATOR = /\b(generate|render|draw|visualize)\b/iu;
const IMAGE_NOUN = /(фото|фотограф|картин|изображен|иллюстрац|портрет|аватар|постер|обложк|логотип|рендер|image|photo|picture|portrait|poster|cover|logo)/iu;
const RU_CREATE_INTENT = /(создай|сделай|поставь|помести|размести|нарисуй|отрендери)/iu;
const EN_CREATE_INTENT = /\b(create|make|place|draw|render)\b/iu;
const VISUAL_SCENE = /(на фоне|в горах|у моря|на море|у океана|на берегу|на пляже|на парковке|на трассе|на дороге|в городе|в лесу|в студии|реалистич|фотореалист|кинематограф|cinematic|background|mountains?|ocean|beach|parking|road|city|forest|studio|photoreal)/iu;

export function detectImageGenerationIntent(text: string): ImageGenerationIntent | null {
  const prompt = text.replace(/\s+/gu, " ").trim().slice(0, 4000);
  if (!prompt) return null;

  const explicit = RU_EXPLICIT_GENERATOR.test(prompt) || EN_EXPLICIT_GENERATOR.test(prompt);
  if (explicit) {
    return { kind: "image_generation", prompt, confidence: "explicit" };
  }

  const createIntent = RU_CREATE_INTENT.test(prompt) || EN_CREATE_INTENT.test(prompt);
  if (createIntent && (IMAGE_NOUN.test(prompt) || VISUAL_SCENE.test(prompt))) {
    return { kind: "image_generation", prompt, confidence: "visual_scene" };
  }

  return null;
}

export function looksLikeImageGenerationRequest(text: string) {
  return detectImageGenerationIntent(text) !== null;
}
