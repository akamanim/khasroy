export function looksLikeWebsiteBuildRequest(value: string) {
  const text = value.replace(/\s+/gu, " ").trim();
  if (!text) return false;
  return /(создай|сделай|собери|разработай|спроектируй|нужен|хочу).{0,70}(сайт|лендинг|landing|website|web[- ]?site)|(?:сайт|лендинг).{0,60}(для|под ключ|с нуля|создать|собрать|разработать)/iu.test(text);
}
