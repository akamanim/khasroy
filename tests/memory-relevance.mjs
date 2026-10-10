import assert from "node:assert/strict";
import {
  isOperationalKnowledge,
  looksLikeOwnerPreference,
  rankKnowledgeForChat,
} from "../lib/memory-relevance.ts";

const at = (day) => `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`;
const item = (memory_key, category, content, confidence, day) => ({
  memory_key,
  category,
  content,
  confidence,
  updated_at: at(day),
});

const jobs = Array.from({ length: 30 }, (_, i) =>
  item(`site_agent_job:${i}`, "site_agent_job", `{"status":"done","url":"https://example${i}.com"}`, 1, 20),
);
const knowledge = [
  ...jobs,
  item("owner_a", "owner_instruction", "Запомни: деплой только через PR, не пушить в main", 1, 5),
  item("owner_b", "owner_preference", "Я предпочитаю короткие ответы на русском", 0.9, 6),
  item("lesson_x", "image_generation_lesson", "Для портретов использовать мягкий свет", 0.99, 13),
  item("note_y", "general", "Проект Хасрой использует Supabase и Vercel", 0.8, 9),
];

// Operational logs must not crowd out owner facts on an unrelated question.
const generic = rankKnowledgeForChat(knowledge, "Как дела? Что нового?", 6);
assert.ok(generic.length >= 2, "owner facts are always available");
assert.ok(generic.every((k) => !isOperationalKnowledge(k.category)), "no job logs for unrelated chat");
assert.equal(generic[0].category.startsWith("owner"), true, "owner facts rank first");

// Owner decisions win over general notes on a matching question.
const deploy = rankKnowledgeForChat(knowledge, "Как мы деплоим изменения в main?", 6);
assert.equal(deploy[0].memory_key, "owner_a", "matching owner decision ranks first");

// Operational knowledge appears only when the question clearly matches it.
const portrait = rankKnowledgeForChat(knowledge, "Какой свет использовать для портретов?", 6);
assert.ok(portrait.some((k) => k.memory_key === "lesson_x"), "matching lesson is recalled");
const weak = rankKnowledgeForChat(knowledge, "портрет", 6);
assert.ok(!weak.some((k) => k.memory_key === "lesson_x"), "single weak word does not pull operational logs");

// General notes need at least one shared word.
assert.ok(rankKnowledgeForChat(knowledge, "Что с Supabase?", 6).some((k) => k.memory_key === "note_y"));

// Limit is respected.
assert.equal(rankKnowledgeForChat(knowledge, "Supabase Vercel Хасрой деплой портрет", 2).length, 2);

// Preference detection.
assert.equal(looksLikeOwnerPreference("Я предпочитаю, чтобы ты отвечал коротко"), true);
assert.equal(looksLikeOwnerPreference("Никогда не пушь в main без PR"), false, "verb form outside the list");
assert.equal(looksLikeOwnerPreference("Никогда не делай деплой без проверки"), true);
assert.equal(looksLikeOwnerPreference("Сколько стоит хостинг?"), false);

console.log("memory relevance: ok");
