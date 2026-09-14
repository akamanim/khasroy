import type { WebStudioSpec } from "@/lib/web-studio";

export type SmmChannel = "instagram" | "tiktok" | "telegram";
export type SmmFormat = "reel" | "carousel" | "story" | "post";

export type SmmContentItem = {
  id: string;
  day: number;
  channel: SmmChannel;
  format: SmmFormat;
  pillar: "offer" | "education" | "trust" | "proof" | "engagement";
  hook: string;
  angle: string;
  cta: string;
  source: string;
};

export type SmmPlan = {
  brandName: string;
  audience: string;
  objective: "lead_generation";
  cadenceDays: number;
  items: SmmContentItem[];
};

function clean(value: string, fallback: string, max = 180) {
  const result = value.replace(/\s+/gu, " ").trim();
  return (result || fallback).slice(0, max);
}

function item(args: Omit<SmmContentItem, "id">): SmmContentItem {
  return { ...args, id: `d${args.day}-${args.channel}-${args.format}-${args.pillar}` };
}

export function buildSmmPlan(spec: WebStudioSpec, cadenceDays = 7): SmmPlan {
  const brandName = clean(spec.brandName, "Бренд", 80);
  const audience = clean(spec.audience, "Клиенты бизнеса", 180);
  const primaryCta = clean(spec.primaryCta, "Оставить заявку", 80);
  const service = clean(spec.services[0] || "Основная услуга", "Основная услуга", 120);
  const service2 = clean(spec.services[1] || service, service, 120);
  const advantage = clean(spec.advantages[0] || "Понятный результат", "Понятный результат", 120);
  const advantage2 = clean(spec.advantages[1] || advantage, advantage, 120);
  const days = Math.min(14, Math.max(3, Math.trunc(cadenceDays) || 7));

  const seeds: Array<Omit<SmmContentItem, "id">> = [
    {
      day: 1,
      channel: "instagram",
      format: "reel",
      pillar: "offer",
      hook: `Почему ${audience.toLowerCase()} выбирают ${brandName}?`,
      angle: `${service}: показать проблему, решение и ожидаемый результат без неподтверждённых обещаний.`,
      cta: primaryCta,
      source: "web-studio:services[0]",
    },
    {
      day: 2,
      channel: "instagram",
      format: "carousel",
      pillar: "education",
      hook: `5 вопросов перед тем, как заказывать ${service.toLowerCase()}`,
      angle: `Объяснить критерии выбора и связать их с преимуществом: ${advantage}.`,
      cta: `Сохраните и напишите нам — ${primaryCta.toLowerCase()}.`,
      source: "web-studio:advantages[0]",
    },
    {
      day: 3,
      channel: "telegram",
      format: "post",
      pillar: "trust",
      hook: `${brandName}: как мы подходим к задаче клиента`,
      angle: `Разобрать процесс работы вокруг ${service2} и принципа «${advantage2}».`,
      cta: primaryCta,
      source: "web-studio:services[1]+advantages[1]",
    },
    {
      day: 4,
      channel: "instagram",
      format: "story",
      pillar: "engagement",
      hook: `Что для вас важнее при выборе ${service.toLowerCase()}?`,
      angle: `Опрос: цена / скорость / качество / ${advantage.toLowerCase()}. Использовать ответы как вход для следующего контента.`,
      cta: "Ответьте в сторис",
      source: "web-studio:audience+advantages[0]",
    },
    {
      day: 5,
      channel: "tiktok",
      format: "reel",
      pillar: "education",
      hook: `3 ошибки, из-за которых ${service.toLowerCase()} не даёт нужного результата`,
      angle: `Короткий разбор ошибок и практический чек-лист для ${audience.toLowerCase()}.`,
      cta: primaryCta,
      source: "web-studio:services[0]+audience",
    },
    {
      day: 6,
      channel: "instagram",
      format: "reel",
      pillar: "proof",
      hook: `Как выглядит хороший результат в ${service.toLowerCase()}`,
      angle: "Показать измеримые критерии результата. Не выдумывать кейсы, цифры, отзывы или клиентов.",
      cta: primaryCta,
      source: "web-studio:description+contactText",
    },
    {
      day: 7,
      channel: "instagram",
      format: "carousel",
      pillar: "offer",
      hook: `${brandName}: что можно заказать прямо сейчас`,
      angle: `Собрать услуги в понятную витрину: ${spec.services.slice(0, 4).join(", ") || service}.`,
      cta: primaryCta,
      source: "web-studio:services",
    },
  ];

  const items: SmmContentItem[] = [];
  for (let day = 1; day <= days; day += 1) {
    const seed = seeds[(day - 1) % seeds.length];
    items.push(item({ ...seed, day }));
  }

  return { brandName, audience, objective: "lead_generation", cadenceDays: days, items };
}
