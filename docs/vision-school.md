# Khasroy Vision School — Photo Generation

Curriculum version: `vision-school-photo-v1`.

The Photo Generation track is intentionally evidence-gated. Web research can advance theory cycles, but it cannot mark a practical image skill as `verified`. Practical verification requires a real image generation or edit plus measurable pass criteria.

## Curriculum

1. Prompt Vision
2. Photographic Composition
3. Lighting & Camera
4. Photorealism
5. Identity Consistency
6. Product Photography
7. Image Visual Auditor
8. Autonomous Image Repair Loop

## Learning loop

`Lesson selection -> Groq Compound Basic Web Search -> Research synthesis -> independent verifier -> knowledge storage -> skill metadata update`

The trainer stores grounded theory in long-term memory and keeps each practical skill in `learning` until image-based tests exist.

## Scheduling

Production uses `/api/vision-school/cron` once per day at `22:17 UTC` (`04:17 Asia/Bishkek`). The cron bridge applies a persistent 20-hour throttle before it can invoke the signed `/api/vision-school/run` trainer.
