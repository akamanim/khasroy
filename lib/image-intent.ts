export type ImageGenerationIntent = {
  kind: "image_generation";
  prompt: string;
  confidence: "explicit" | "visual_scene";
};

const EXPLICIT_GENERATOR = /\b(сгенерируй|генерируй|нарисуй|отрендери|визуализируй|создай\s+(?:фото|фотографию|картинку|изображение|иллюстрацию|портрет|аватар|постер|обложку|логотип)|generate|render|draw|visualize)\b/iu;
const IMAGE_NOUN = /(фото|фотограф|картин|изображен|иллюстрац|портрет|аватар|постер|обложк|логотип|рендер|image|photo|picture|portrait|poster|cover|logo)/iu;
const CREATE_INTENT = /\b(создай|сделай|поставь|помести|размести|нарисуй|отрендери|create|make|place|draw|render)\b/iu;
const VISUAL_SCENE = /(на фоне|в горах|у моря|на море|у океана|на берегу|на пляже|на парковке|на трассе|на дороге|в городе|в лесу|в студии|реалистич|фотореалист|кинематограф|cinematic|background|mountains?|ocean|beach|parking|road|city|forest|studio|photoreal)/iu;

export function detectImageGenerationIntent(text: string): ImageGenerationIntent | null {
  const prompt = text.replace(/\s+/gu, " ").trim().slice(0, 4000);
  if (!prompt) return null;

  if (EXPLICIT_GENERATOR.test(prompt)) {
    return { kind: "image_generation", prompt, confidence: "explicit" };
  }

  if (CREATE_INTENT.test(prompt) && (IMAGE_NOUN.test(prompt) || VISUAL_SCENE.test(prompt))) {
    return { kind: "image_generation", prompt, confidence: "visual_scene" };
  }

  return null;
}

export function looksLikeImageGenerationRequest(text: string) {
  return detectImageGenerationIntent(text) !== null;
}
