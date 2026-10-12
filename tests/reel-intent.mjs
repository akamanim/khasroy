import assert from "node:assert/strict";
import { looksLikeReelRequest } from "../lib/reels/intent.ts";
for (const t of ["Сделай рилс про голосовые", "напиши сценарий ролика для инстаграм", "Хочу reels: 168 часов в неделе", "Рилс: клиент просит скидку, придумай"]) assert.ok(looksLikeReelRequest(t), t);
for (const t of ["что такое рилс?", "Найди свежие новости об ИИ", "посмотри сайт и выпиши цены"]) assert.ok(!looksLikeReelRequest(t), t);
console.log("reel intent: ok");
