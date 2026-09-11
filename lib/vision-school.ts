export type VisionLesson = {
  slug: string;
  level: number;
  name: string;
  objective: string;
  researchQueries: string[];
  passCriteria: string[];
};

export const PHOTO_GENERATION_CURRICULUM_VERSION = "vision-school-photo-v1";

export const PHOTO_GENERATION_LESSONS: VisionLesson[] = [
  {
    slug: "photo_prompt_vision",
    level: 1,
    name: "Prompt Vision",
    objective: "Преобразовывать короткий пользовательский запрос в точное техническое задание для генератора изображений без выдумывания лишних требований.",
    researchQueries: [
      "image generation prompt structure subject scene composition lighting camera style constraints",
      "text to image prompt adherence evaluation methods",
    ],
    passCriteria: [
      "выделены субъект, сцена, действие и формат",
      "отдельно заданы композиция, свет, камера и ограничения",
      "сохранён исходный смысл запроса пользователя",
    ],
  },
  {
    slug: "photo_composition",
    level: 2,
    name: "Photographic Composition",
    objective: "Проектировать кадр: масштаб субъекта, ракурс, глубину, перспективу, негативное пространство и расположение объектов.",
    researchQueries: [
      "photography composition subject placement perspective depth visual hierarchy practical guide",
      "cinematic composition rule of thirds leading lines negative space photography",
    ],
    passCriteria: [
      "композиция соответствует задаче",
      "главный объект визуально доминирует",
      "нет конфликтующих перспектив и случайных обрезаний",
    ],
  },
  {
    slug: "photo_lighting_camera",
    level: 3,
    name: "Lighting & Camera",
    objective: "Осознанно выбирать схему света, направление теней, фокусное расстояние, глубину резкости и характер изображения.",
    researchQueries: [
      "portrait product automotive photography lighting key fill rim light practical",
      "camera focal length depth of field perspective photography 24mm 35mm 50mm 85mm",
    ],
    passCriteria: [
      "свет физически согласован",
      "выбран уместный объектив и ракурс",
      "глубина резкости поддерживает композицию",
    ],
  },
  {
    slug: "photo_realism",
    level: 4,
    name: "Photorealism",
    objective: "Повышать правдоподобие кожи, рук, волос, материалов, отражений, теней и микротекстур без пластикового CGI-вида.",
    researchQueries: [
      "photorealistic image generation common artifacts hands skin reflections shadows evaluation",
      "synthetic image realism perceptual evaluation texture lighting anatomy artifacts",
    ],
    passCriteria: [
      "анатомия и руки без явных дефектов",
      "материалы и отражения правдоподобны",
      "тени и источники света согласованы",
    ],
  },
  {
    slug: "photo_identity_consistency",
    level: 5,
    name: "Identity Consistency",
    objective: "Сохранять узнаваемость одного человека между разными сценами, одеждой, освещением и ракурсами при наличии разрешённых референсов.",
    researchQueries: [
      "identity consistency reference image generation face similarity evaluation",
      "face embedding similarity identity preservation generative images evaluation",
    ],
    passCriteria: [
      "ключевые пропорции лица стабильны",
      "изменение сцены не подменяет личность",
      "референсы используются только с разрешением владельца",
    ],
  },
  {
    slug: "photo_product_generation",
    level: 6,
    name: "Product Photography",
    objective: "Создавать рекламную сцену вокруг товара, сохраняя форму, цвет, надписи и ключевые особенности исходного продукта.",
    researchQueries: [
      "product photography lighting composition ecommerce luxury product image best practices",
      "product image generation identity preservation packaging text logo consistency",
    ],
    passCriteria: [
      "товар остаётся главным объектом",
      "ключевые свойства товара не искажены",
      "фон и свет соответствуют рекламной задаче",
    ],
  },
  {
    slug: "image_visual_auditor",
    level: 7,
    name: "Image Visual Auditor",
    objective: "Оценивать сгенерированное изображение по отдельным измеримым категориям и выдавать доказуемые замечания вместо общей вкусовой оценки.",
    researchQueries: [
      "AI generated image quality evaluation prompt adherence composition realism artifact detection metrics",
      "vision language model image critique rubric human preference evaluation",
    ],
    passCriteria: [
      "оценки разделены по критериям",
      "каждый дефект локализован и объяснён",
      "аудитор отличает факт от субъективного предпочтения",
    ],
  },
  {
    slug: "image_repair_loop",
    level: 8,
    name: "Autonomous Image Repair Loop",
    objective: "После аудита формировать минимальный targeted repair: сохранять удачные части изображения и исправлять только найденные дефекты.",
    researchQueries: [
      "iterative image generation critique refinement loop visual feedback targeted editing",
      "image editing preserve identity composition targeted correction generative model workflow",
    ],
    passCriteria: [
      "repair-инструкция адресует конкретные дефекты",
      "удачные элементы явно защищены от лишнего изменения",
      "повторный аудит подтверждает улучшение без регрессии",
    ],
  },
];

export const PHOTO_GENERATION_SKILL_SLUGS = PHOTO_GENERATION_LESSONS.map(
  (lesson) => lesson.slug,
);

export function photoGenerationGoalDescription() {
  return [
    "Khasroy Vision School: системно развивать генерацию и редактирование фотографий.",
    "Проходить программу последовательно, но не повторять недавно изученное:",
    ...PHOTO_GENERATION_LESSONS.map(
      (lesson) => `${lesson.level}. ${lesson.name}: ${lesson.objective}`,
    ),
    "Каждый цикл должен выбрать одну узкую тему из этой программы, провести веб-исследование по реальным источникам, сформулировать проверяемый вывод и безопасный эксперимент.",
    "Не считать навык VERIFIED только на основании теории. VERIFIED разрешён лишь после реального теста генерации/анализа с измеримым pass criteria.",
    "Не менять production-изображения, лица пользователей, права доступа, Security Core или секреты без явного запроса владельца.",
  ].join("\n");
}
