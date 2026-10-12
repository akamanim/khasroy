/** True when the owner asks the chat to make a reel (not when they only talk about reels). */
export function looksLikeReelRequest(text: string): boolean {
  const t = text.toLowerCase();
  const reel = /(рилс|reels?\b|ролик|видео для (инст|instagram|ватсап|whatsapp)|сторис|тикток|tiktok|shorts)/u.test(t);
  const make = /(сделай|создай|напиши|сними|придумай|собери|нужен|нужно|хочу|сценари|подготовь|давай)/u.test(t);
  return reel && make;
}
