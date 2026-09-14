"use client";

import { Download, FileUp, Sparkles, WandSparkles, X } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import styles from "./studio-magic.module.css";

const STORAGE_KEY = "khasroy-studio-v1";

type TemplateName = "luxury" | "business" | "construction" | "minimal";

type ElementStyle = {
  color: string;
  background: string;
  fontSize: number;
  fontWeight: number;
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
  textAlign: "left" | "center" | "right";
};

type StudioElement = {
  id: string;
  kind: "text" | "button" | "image" | "box";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  src: string;
  href: string;
  style: ElementStyle;
};

type StoredProject = {
  projectName: string;
  pageBackground: string;
  pageHeight: number;
  elements: StudioElement[];
};

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `magic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function textElement(
  name: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  color: string,
  weight = 500,
): StudioElement {
  return {
    id: uid(),
    kind: "text",
    name,
    x,
    y,
    width,
    height,
    text,
    src: "",
    href: "",
    style: {
      color,
      background: "transparent",
      fontSize,
      fontWeight: weight,
      borderRadius: 0,
      borderWidth: 0,
      borderColor: "transparent",
      textAlign: "left",
    },
  };
}

function buttonElement(
  text: string,
  x: number,
  y: number,
  background: string,
  color: string,
): StudioElement {
  return {
    id: uid(),
    kind: "button",
    name: "CTA кнопка",
    x,
    y,
    width: 205,
    height: 54,
    text,
    src: "",
    href: "#contact",
    style: {
      color,
      background,
      fontSize: 15,
      fontWeight: 700,
      borderRadius: 16,
      borderWidth: 0,
      borderColor: "transparent",
      textAlign: "center",
    },
  };
}

function boxElement(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  background: string,
  borderColor: string,
  radius = 26,
): StudioElement {
  return {
    id: uid(),
    kind: "box",
    name,
    x,
    y,
    width,
    height,
    text: "",
    src: "",
    href: "",
    style: {
      color: "#ffffff",
      background,
      fontSize: 16,
      fontWeight: 500,
      borderRadius: radius,
      borderWidth: 1,
      borderColor,
      textAlign: "left",
    },
  };
}

function template(name: TemplateName): StoredProject {
  if (name === "luxury") {
    return {
      projectName: "Dark Luxury",
      pageBackground: "#090807",
      pageHeight: 980,
      elements: [
        textElement("Метка", "PRIVATE COLLECTION / 2026", 82, 92, 420, 30, 13, "#b89f73", 700),
        textElement("Главный заголовок", "Материалы, которые превращают интерьер в архитектуру", 82, 145, 700, 220, 64, "#f4efe7", 700),
        textElement("Описание", "Дерево, мрамор и камень. Точная подборка фактур для премиальных пространств.", 86, 392, 590, 90, 20, "#aaa39a", 400),
        buttonElement("Смотреть коллекцию", 86, 520, "#c4aa7b", "#17120c"),
        boxElement("Фото-зона", 805, 118, 310, 465, "#181512", "#463a2c", 34),
        textElement("Карточка 01", "ДЕРЕВО", 92, 720, 250, 60, 28, "#e7ded1", 600),
        textElement("Карточка 02", "МРАМОР", 425, 720, 250, 60, 28, "#e7ded1", 600),
        textElement("Карточка 03", "КАМЕНЬ", 760, 720, 250, 60, 28, "#e7ded1", 600),
      ],
    };
  }

  if (name === "construction") {
    return {
      projectName: "Construction Pro",
      pageBackground: "#0c1115",
      pageHeight: 980,
      elements: [
        textElement("Метка", "ПРОИЗВОДСТВО / БИШКЕК", 76, 90, 390, 28, 13, "#f1a64b", 700),
        textElement("Главный заголовок", "Профнастил и металлочерепица без лишней наценки", 76, 142, 720, 190, 58, "#f5f7f8", 800),
        textElement("Описание", "Расчёт, производство и отгрузка. Понятные цены и быстрый заказ для частных и строительных объектов.", 80, 360, 615, 88, 19, "#9cacb6", 400),
        buttonElement("Получить расчёт", 80, 490, "#f0a044", "#17120b"),
        boxElement("Визуал продукции", 815, 112, 295, 430, "#18232a", "#36505f", 28),
        textElement("Преимущество 1", "СВОЁ ПРОИЗВОДСТВО", 80, 700, 290, 46, 22, "#f0a044", 700),
        textElement("Преимущество 2", "ТОЧНЫЕ РАЗМЕРЫ", 420, 700, 290, 46, 22, "#f5f7f8", 700),
        textElement("Преимущество 3", "БЫСТРАЯ ОТГРУЗКА", 760, 700, 320, 46, 22, "#f5f7f8", 700),
      ],
    };
  }

  if (name === "business") {
    return {
      projectName: "Business Landing",
      pageBackground: "#07121b",
      pageHeight: 940,
      elements: [
        textElement("Метка", "BUSINESS SYSTEM / 01", 82, 86, 360, 28, 12, "#70c9e8", 700),
        textElement("Главный заголовок", "Сайт, который объясняет ценность бизнеса за несколько секунд", 82, 142, 740, 200, 60, "#eef8fb", 750),
        textElement("Описание", "Сильный оффер, понятная структура и один ясный следующий шаг для клиента.", 86, 375, 570, 82, 20, "#9db1bc", 400),
        buttonElement("Обсудить проект", 86, 495, "#8fdcf3", "#061017"),
        boxElement("Аналитика", 830, 125, 270, 370, "#0f2530", "#275568", 28),
        textElement("Статистика", "+37%\nк заявкам", 870, 215, 200, 110, 34, "#8fdcf3", 800),
        textElement("Нижний заголовок", "СТРУКТУРА / ДИЗАЙН / КОНВЕРСИЯ", 88, 720, 860, 70, 30, "#dcebf0", 700),
      ],
    };
  }

  return {
    projectName: "Minimal Landing",
    pageBackground: "#f3f1eb",
    pageHeight: 940,
    elements: [
      textElement("Метка", "STUDIO 01", 80, 88, 260, 28, 12, "#6b6b65", 700),
      textElement("Главный заголовок", "Простой интерфейс. Сильная идея.", 80, 150, 780, 180, 70, "#171816", 700),
      textElement("Описание", "Убираем шум и оставляем только то, что помогает человеку быстро понять продукт.", 84, 365, 600, 92, 20, "#5d615c", 400),
      buttonElement("Начать", 84, 500, "#171816", "#f5f3ee"),
      boxElement("Минималистичный визуал", 840, 120, 260, 430, "#ddd9d0", "#c8c3b8", 18),
      textElement("Финальная строка", "LESS NOISE. MORE MEANING.", 84, 735, 780, 70, 32, "#171816", 700),
    ],
  };
}

export function StudioMagic() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function applyTemplate(name: TemplateName) {
    const confirmed = window.confirm("Заменить текущий макет выбранным шаблоном? Текущий черновик будет перезаписан.");
    if (!confirmed) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(template(name)));
    window.location.reload();
  }

  function exportProject() {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setMessage("Сначала сохрани проект в Studio.");
      return;
    }
    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `khasroy-studio-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Проект экспортирован.");
  }

  async function importProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<StoredProject>;
      if (!parsed || !Array.isArray(parsed.elements) || typeof parsed.projectName !== "string") {
        throw new Error("invalid_project");
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      window.location.reload();
    } catch {
      setMessage("Не удалось открыть этот файл проекта.");
    }
  }

  return (
    <div className={styles.magicRoot}>
      <input
        ref={fileRef}
        className={styles.hiddenInput}
        type="file"
        accept="application/json,.json"
        onChange={importProject}
      />

      {open && (
        <div className={styles.panel}>
          <div className={styles.header}>
            <div>
              <span>KHASROY MAGIC</span>
              <strong>Быстрый старт сайта</strong>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Закрыть">
              <X size={16} />
            </button>
          </div>

          <p className={styles.lead}>
            Один клик — и на холсте появляется готовая композиция, которую дальше можно разобрать и изменить руками.
          </p>

          <div className={styles.templates}>
            <button onClick={() => applyTemplate("luxury")}>
              <span>01</span><strong>Dark Luxury</strong><small>Премиум / интерьер</small>
            </button>
            <button onClick={() => applyTemplate("construction")}>
              <span>02</span><strong>Construction Pro</strong><small>Стройка / производство</small>
            </button>
            <button onClick={() => applyTemplate("business")}>
              <span>03</span><strong>Business Landing</strong><small>Услуги / продажи</small>
            </button>
            <button onClick={() => applyTemplate("minimal")}>
              <span>04</span><strong>Minimal</strong><small>Чистый редакционный стиль</small>
            </button>
          </div>

          <div className={styles.transfer}>
            <button onClick={exportProject}><Download size={15} /> Экспорт проекта</button>
            <button onClick={() => fileRef.current?.click()}><FileUp size={15} /> Импорт проекта</button>
          </div>

          {message && <div className={styles.message}>{message}</div>}
        </div>
      )}

      <button className={styles.magicButton} onClick={() => setOpen((value) => !value)}>
        {open ? <Sparkles size={18} /> : <WandSparkles size={18} />}
        <span>MAGIC</span>
      </button>
    </div>
  );
}
