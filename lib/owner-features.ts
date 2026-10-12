// What Khasroy can do, for the "Все функции" window on the owner console. The status says how
// sure we are, not how good the feature sounds:
//   verified — checked working on the live site;
//   built    — in the code and deployed, not re-checked recently;
//   setup    — in the code, needs keys or settings before it can work.
// Update this list together with the feature.

export type FeatureStatus = "verified" | "built" | "setup";

export type Feature = { name: string; what: string; status: FeatureStatus; href?: string };

export type FeatureGroup = { title: string; items: Feature[] };

export const FEATURE_STATUS: Record<FeatureStatus, string> = {
  verified: "проверено",
  built: "есть",
  setup: "нужна настройка",
};

export const FEATURES: FeatureGroup[] = [
  {
    title: "Приглашения",
    items: [
      { name: "Студия приглашений", what: "Хасрой собирает приглашение в разговоре: шаблон, тексты, дата, место, фото.", status: "verified", href: "/" },
      { name: "Шаблоны с примерами", what: "Готовые оформления, в том числе «Свадьба востока», с демо-страницами.", status: "verified", href: "/demo/golden" },
      { name: "Страница приглашения", what: "Гость открывает ссылку, отвечает «приду / не приду», указывает сколько человек.", status: "verified" },
      { name: "Список гостей и Excel", what: "Ответы гостей в таблице, выгрузка в Excel.", status: "verified" },
      { name: "Личные ссылки", what: "Ссылка с именем гостя: приглашение обращается к нему лично.", status: "verified" },
      { name: "Превью в WhatsApp", what: "Красивая карточка с фото и датой, когда ссылкой делятся в мессенджере.", status: "verified" },
      { name: "Короткая ссылка и QR-код", what: "Свой короткий адрес и QR-код для печати.", status: "verified" },
      { name: "Лента пожеланий", what: "Гости оставляют пожелания, организатор может скрыть лишнее.", status: "verified" },
      { name: "Маршрут в 2ГИС", what: "Кнопка, которая открывает дорогу до места в 2ГИС.", status: "verified" },
      { name: "Правки после заказа", what: "Клиент может поправить приглашение и после оформления.", status: "verified" },
      { name: "Заказы", what: "Все заказы и их статусы для владельца.", status: "verified", href: "/owner/orders" },
    ],
  },
  {
    title: "Продажник",
    items: [
      { name: "Продавец-консультант Graviti", what: "Отвечает покупателям как живой продавец, факты берёт только из базы товаров.", status: "verified", href: "/sales" },
      { name: "Вариант Б (воронка)", what: "Ведёт покупателя по шагам: выяснить нужду, подобрать, взять контакт.", status: "built", href: "/sales/b" },
      { name: "Заявки", what: "Имена и телефоны, которые оставили покупатели.", status: "verified", href: "/sales/leads" },
      { name: "База из Google-таблицы", what: "Товары, цены и ответы на вопросы можно вести в Google-таблице.", status: "built" },
    ],
  },
  {
    title: "Облачный браузер",
    items: [
      { name: "Открыть сайт", what: "Настоящий Chromium на сервере: адрес, снимок экрана, нажатия, ввод текста, листание.", status: "verified" },
      { name: "Задачи в браузере", what: "Хасрой сам ходит по сайтам по шагам и приносит итог с источниками.", status: "built" },
      { name: "Подтверждение опасных действий", what: "Покупка, отправка формы, вход — только после вашего «Подтвердить». Пароли и карты не вводит.", status: "built" },
    ],
  },
  {
    title: "Консоль и разговор",
    items: [
      { name: "Чат с Хасроем", what: "Разговор, вопросы, задачи. Работает на бесплатных моделях Groq, запасная — Llama через Cloudflare.", status: "verified", href: "/owner" },
      { name: "Знает свой код", what: "Читает свой репозиторий на GitHub и отвечает, что изменилось.", status: "built" },
      { name: "Поиск в интернете", what: "Ищет свежие новости и отвечает по найденным источникам.", status: "built" },
      { name: "Запуск кода", what: "Выполняет Python или JavaScript в изолированной песочнице Vercel.", status: "built" },
      { name: "Память и навыки", what: "Запоминает важное и учит навыки; проверенные навыки видны ниже.", status: "built" },
      { name: "Табло владельца", what: "Цифры приглашений и продажника, состояние моделей, последние изменения.", status: "verified" },
    ],
  },
  {
    title: "Есть в коде, нужна настройка",
    items: [
      { name: "Веб-студия", what: "Собирает сайт и выкладывает его на GitHub и Vercel.", status: "setup", href: "/settings" },
      { name: "SMM и Instagram", what: "План постов, тексты, публикация в Instagram.", status: "setup", href: "/settings" },
      { name: "Аудит сайтов", what: "Оценивает сайт по снимкам с телефона и компьютера: что мешает продажам.", status: "built" },
      { name: "Картинки", what: "Создание и проверка изображений.", status: "built" },
      { name: "Школа зрения", what: "Ежедневное обучение распознаванию изображений по расписанию.", status: "built" },
    ],
  },
];
