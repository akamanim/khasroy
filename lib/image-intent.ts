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
const CREATE_INTENT = /(создай|сделай|поставь|помести|размести|нарисуй|отрендери|\bcreate\b|\bmake\b|\bplace\b|\bdraw\b|\brender\b)/iu;
const VISUAL_SCENE = /(на фоне|в горах|у моря|на море|у океана|на берегу|на пляже|на парковке|на трассе|на дороге|в городе|в лесу|в студии|реалистич|фотореалист|кинематограф|cinematic|background|mountains?|ocean|beach|parking|road|city|forest|studio|photoreal)/iu;
const META_OUTPUT = /(парол|\bpassword\b|код|\bcode\b|json|xml|sql|таблиц|список|текст|письм|сообщен|промпт|\bprompt\b|инструкц|описан|назван|иде[яи]|скрипт|\bscript\b|регуляр|\bregex\b)/iu;

function metaOutputComesBeforeImage(prompt: string) {
  const meta = META_OUTPUT.exec(prompt);
  if (!meta) return false;
  const image = IMAGE_NOUN.exec(prompt);
  return !image || (meta.index ?? 0) < (image.index ?? Number.MAX_SAFE_INTEGER);
}

export function detectImageGenerationIntent(text: string): ImageGenerationIntent | null {
  const prompt = text.replace(/\s+/gu, " ").trim().slice(0, 4000);
  if (!prompt) return null;

  // "Сгенерируй промпт для фото" asks for text, while
  // "Сгенерируй изображение по этому промпту" asks for an image.
  if (metaOutputComesBeforeImage(prompt)) return null;

  if (RU_EXPLICIT_GENERATOR.test(prompt) || EN_EXPLICIT_GENERATOR.test(prompt)) {
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
