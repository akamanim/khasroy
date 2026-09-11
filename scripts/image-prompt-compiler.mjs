#!/usr/bin/env node

function clean(value, max = 1200) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function cleanList(value, maxItems = 8) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clean(item, 400)).filter(Boolean).slice(0, maxItems);
}

export function compileImagePrompt(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new TypeError("image prompt spec must be an object");
  }

  const originalRequest = clean(spec.originalRequest, 1600);
  const subject = clean(spec.subject, 1200);
  if (!subject) throw new Error("subject is required");

  const fields = [
    ["Original request", originalRequest],
    ["Subject", subject],
    ["Scene", clean(spec.scene)],
    ["Composition", clean(spec.composition)],
    ["Lighting", clean(spec.lighting)],
    ["Camera", clean(spec.camera)],
    ["Style", clean(spec.style)],
  ];

  const lines = fields.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
  const constraints = cleanList(spec.constraints);
  if (constraints.length) lines.push(`Constraints: ${constraints.join("; ")}`);

  return lines.join("\n");
}

export function runSelfTest() {
  const failures = [];
  const assert = (condition, message) => {
    if (!condition) failures.push(message);
  };

  const full = compileImagePrompt({
    originalRequest: "Серебряный тасбих на тёмном столе, без текста",
    subject: "silver tasbih with 33 beads",
    scene: "dark matte tabletop",
    composition: "centered product shot with negative space above",
    lighting: "soft side light from the left",
    camera: "eye-level close product photograph",
    style: "photorealistic commercial product photography",
    constraints: ["no text", "no watermark", "do not add extra objects"],
  });

  assert(full.includes("Original request: Серебряный тасбих на тёмном столе, без текста"), "original request was not preserved");
  assert(full.includes("Subject: silver tasbih with 33 beads"), "subject missing");
  assert(full.includes("Scene: dark matte tabletop"), "scene missing");
  assert(full.includes("Composition: centered product shot with negative space above"), "composition missing");
  assert(full.includes("Lighting: soft side light from the left"), "lighting missing");
  assert(full.includes("Camera: eye-level close product photograph"), "camera missing");
  assert(full.includes("Style: photorealistic commercial product photography"), "style missing");
  assert(full.includes("Constraints: no text; no watermark; do not add extra objects"), "constraints missing");

  const sparse = compileImagePrompt({ subject: "red ceramic mug" });
  assert(sparse === "Subject: red ceramic mug", "sparse prompt invented unspecified fields");
  assert(!/Lighting:|Camera:|Style:|Constraints:/.test(sparse), "sparse prompt added defaults");

  let rejected = false;
  try {
    compileImagePrompt({ scene: "empty studio" });
  } catch {
    rejected = true;
  }
  assert(rejected, "missing subject was not rejected");

  const result = { skill: "structured_image_prompt_compiler", passed: failures.length === 0, checks: 11, failures, samplePrompt: full };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runSelfTest();
}
