"use client";

import {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers3,
  Monitor,
  MousePointer2,
  Plus,
  RotateCcw,
  Save,
  Smartphone,
  Square,
  Tablet,
  Trash2,
  Type,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import styles from "./studio.module.css";

type Viewport = "desktop" | "tablet" | "mobile";
type ElementKind = "text" | "button" | "image" | "box";
type TextAlign = "left" | "center" | "right";

type ElementStyle = {
  color: string;
  background: string;
  fontSize: number;
  fontWeight: number;
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
  textAlign: TextAlign;
};

type StudioElement = {
  id: string;
  kind: ElementKind;
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

const STORAGE_KEY = "khasroy-studio-v1";
const VIEWPORT_WIDTHS: Record<Viewport, number> = {
  desktop: 1200,
  tablet: 768,
  mobile: 390,
};

const baseStyle: ElementStyle = {
  color: "#f4f7f9",
  background: "transparent",
  fontSize: 20,
  fontWeight: 500,
  borderRadius: 12,
  borderWidth: 0,
  borderColor: "#6aa8bd",
  textAlign: "left",
};

function id() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `studio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function starterElements(): StudioElement[] {
  return [
    {
      id: id(),
      kind: "text",
      name: "Главный заголовок",
      x: 78,
      y: 105,
      width: 690,
      height: 150,
      text: "Собери сайт руками — без кода",
      src: "",
      href: "",
      style: {
        ...baseStyle,
        fontSize: 58,
        fontWeight: 700,
        color: "#f3f9fb",
      },
    },
    {
      id: id(),
      kind: "text",
      name: "Описание",
      x: 82,
      y: 282,
      width: 560,
      height: 92,
      text: "Перетаскивай блоки, меняй размеры, цвета и текст. Хасрой держит код под капотом.",
      src: "",
      href: "",
      style: {
        ...baseStyle,
        fontSize: 20,
        fontWeight: 400,
        color: "#9eb1bd",
      },
    },
    {
      id: id(),
      kind: "button",
      name: "Кнопка",
      x: 82,
      y: 408,
      width: 190,
      height: 52,
      text: "Начать проект",
      src: "",
      href: "#",
      style: {
        ...baseStyle,
        color: "#071117",
        background: "#9ddff2",
        fontSize: 15,
        fontWeight: 700,
        borderRadius: 16,
        textAlign: "center",
      },
    },
    {
      id: id(),
      kind: "box",
      name: "Декоративный блок",
      x: 810,
      y: 100,
      width: 300,
      height: 360,
      text: "",
      src: "",
      href: "",
      style: {
        ...baseStyle,
        background: "#10212b",
        borderWidth: 1,
        borderColor: "#2e5564",
        borderRadius: 30,
      },
    },
  ];
}

function defaultElement(kind: ElementKind, canvasWidth: number): StudioElement {
  const common = {
    id: id(),
    kind,
    x: Math.max(24, Math.round(canvasWidth / 2 - 140)),
    y: 120,
    src: "",
    href: "",
  };

  if (kind === "text") {
    return {
      ...common,
      name: "Текст",
      width: 420,
      height: 80,
      text: "Новый текст",
      style: { ...baseStyle, fontSize: 34, fontWeight: 600 },
    };
  }

  if (kind === "button") {
    return {
      ...common,
      name: "Кнопка",
      width: 180,
      height: 52,
      text: "Кнопка",
      href: "#",
      style: {
        ...baseStyle,
        color: "#071117",
        background: "#9ddff2",
        fontSize: 15,
        fontWeight: 700,
        borderRadius: 14,
        textAlign: "center",
      },
    };
  }

  if (kind === "image") {
    return {
      ...common,
      name: "Изображение",
      width: 360,
      height: 260,
      text: "",
      style: {
        ...baseStyle,
        background: "#111b23",
        borderWidth: 1,
        borderColor: "#30434f",
        borderRadius: 20,
      },
    };
  }

  return {
    ...common,
    name: "Блок",
    width: 320,
    height: 220,
    text: "",
    style: {
      ...baseStyle,
      background: "#14232c",
      borderWidth: 1,
      borderColor: "#33505d",
      borderRadius: 24,
    },
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function alignToFlex(value: TextAlign) {
  if (value === "center") return "center";
  if (value === "right") return "flex-end";
  return "flex-start";
}

export default function StudioPage() {
  const [projectName, setProjectName] = useState("Новый сайт");
  const [elements, setElements] = useState<StudioElement[]>(() => starterElements());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [zoom, setZoom] = useState(0.75);
  const [preview, setPreview] = useState(false);
  const [pageBackground, setPageBackground] = useState("#0b1117");
  const [pageHeight, setPageHeight] = useState(900);
  const [savedAt, setSavedAt] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    pointerX: number;
    pointerY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const canvasWidth = VIEWPORT_WIDTHS[viewport];
  const selected = useMemo(
    () => elements.find((element) => element.id === selectedId) ?? null,
    [elements, selectedId],
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<StoredProject>;
        if (typeof stored.projectName === "string") setProjectName(stored.projectName);
        if (typeof stored.pageBackground === "string") setPageBackground(stored.pageBackground);
        if (typeof stored.pageHeight === "number") setPageHeight(stored.pageHeight);
        if (Array.isArray(stored.elements) && stored.elements.length > 0) {
          setElements(stored.elements as StudioElement[]);
        }
      }
    } catch {
      // Keep the starter project if a local draft is corrupted.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const payload: StoredProject = {
        projectName,
        pageBackground,
        pageHeight,
        elements,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      setSavedAt(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [elements, pageBackground, pageHeight, projectName, hydrated]);

  useEffect(() => {
    function move(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = (event.clientX - drag.pointerX) / zoom;
      const dy = (event.clientY - drag.pointerY) / zoom;
      setElements((current) =>
        current.map((element) => {
          if (element.id !== drag.id) return element;
          return {
            ...element,
            x: Math.round(clamp(drag.startX + dx, 0, Math.max(0, canvasWidth - element.width))),
            y: Math.round(clamp(drag.startY + dy, 0, Math.max(0, pageHeight - element.height))),
          };
        }),
      );
    }

    function up() {
      dragRef.current = null;
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [canvasWidth, pageHeight, zoom]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (!selectedId || preview) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        setElements((current) => current.filter((element) => element.id !== selectedId));
        setSelectedId(null);
        return;
      }

      const delta = event.shiftKey ? 10 : 1;
      const movement: Record<string, [number, number]> = {
        ArrowLeft: [-delta, 0],
        ArrowRight: [delta, 0],
        ArrowUp: [0, -delta],
        ArrowDown: [0, delta],
      };
      const change = movement[event.key];
      if (!change) return;
      event.preventDefault();
      setElements((current) =>
        current.map((element) =>
          element.id === selectedId
            ? {
                ...element,
                x: clamp(element.x + change[0], 0, Math.max(0, canvasWidth - element.width)),
                y: clamp(element.y + change[1], 0, Math.max(0, pageHeight - element.height)),
              }
            : element,
        ),
      );
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canvasWidth, pageHeight, preview, selectedId]);

  function persistNow() {
    const payload: StoredProject = { projectName, pageBackground, pageHeight, elements };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    setSavedAt(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
  }

  function addElement(kind: ElementKind) {
    const next = defaultElement(kind, canvasWidth);
    setElements((current) => [...current, next]);
    setSelectedId(next.id);
  }

  function updateSelected(patch: Partial<StudioElement>) {
    if (!selectedId) return;
    setElements((current) =>
      current.map((element) => (element.id === selectedId ? { ...element, ...patch } : element)),
    );
  }

  function updateSelectedStyle(patch: Partial<ElementStyle>) {
    if (!selectedId) return;
    setElements((current) =>
      current.map((element) =>
        element.id === selectedId
          ? { ...element, style: { ...element.style, ...patch } }
          : element,
      ),
    );
  }

  function duplicateSelected() {
    if (!selected) return;
    const duplicate: StudioElement = {
      ...selected,
      id: id(),
      name: `${selected.name} копия`,
      x: clamp(selected.x + 20, 0, Math.max(0, canvasWidth - selected.width)),
      y: clamp(selected.y + 20, 0, Math.max(0, pageHeight - selected.height)),
      style: { ...selected.style },
    };
    setElements((current) => [...current, duplicate]);
    setSelectedId(duplicate.id);
  }

  function deleteSelected() {
    if (!selectedId) return;
    setElements((current) => current.filter((element) => element.id !== selectedId));
    setSelectedId(null);
  }

  function moveLayer(elementId: string, direction: -1 | 1) {
    setElements((current) => {
      const index = current.findIndex((element) => element.id === elementId);
      if (index < 0) return current;
      const nextIndex = clamp(index + direction, 0, current.length - 1);
      if (nextIndex === index) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }

  function resetProject() {
    const confirmed = window.confirm("Очистить текущий макет и вернуть стартовый пример?");
    if (!confirmed) return;
    setProjectName("Новый сайт");
    setPageBackground("#0b1117");
    setPageHeight(900);
    setElements(starterElements());
    setSelectedId(null);
  }

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>, element: StudioElement) {
    if (preview) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(element.id);
    dragRef.current = {
      id: element.id,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: element.x,
      startY: element.y,
    };
  }

  function elementCss(element: StudioElement, index: number): CSSProperties {
    return {
      left: element.x,
      top: element.y,
      width: element.width,
      height: element.height,
      color: element.style.color,
      background: element.style.background,
      fontSize: element.style.fontSize,
      fontWeight: element.style.fontWeight,
      borderRadius: element.style.borderRadius,
      borderWidth: element.style.borderWidth,
      borderColor: element.style.borderColor,
      borderStyle: element.style.borderWidth > 0 ? "solid" : "none",
      textAlign: element.style.textAlign,
      justifyContent: alignToFlex(element.style.textAlign),
      zIndex: index + 1,
    };
  }

  return (
    <div className={`${styles.studio} ${preview ? styles.previewMode : ""}`}>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <a className={styles.back} href="/" aria-label="Назад к Хасрою">
            <ArrowLeft size={17} />
          </a>
          <div className={styles.logo}>K</div>
          <div>
            <div className={styles.title}>KHASROY STUDIO <span>BETA</span></div>
            <div className={styles.subtitle}>NO-CODE WEB LAB</div>
          </div>
        </div>

        <input
          className={styles.projectName}
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
          aria-label="Название проекта"
        />

        <div className={styles.topbarActions}>
          <span className={styles.saved}>{savedAt ? `Сохранено ${savedAt}` : "Локальный черновик"}</span>
          <button className={styles.iconButton} onClick={persistNow} title="Сохранить">
            <Save size={17} />
          </button>
          <button
            className={`${styles.previewButton} ${preview ? styles.activeButton : ""}`}
            onClick={() => {
              setPreview((value) => !value);
              setSelectedId(null);
            }}
          >
            {preview ? <EyeOff size={16} /> : <Eye size={16} />}
            {preview ? "Редактор" : "Превью"}
          </button>
        </div>
      </header>

      <div className={styles.workspace}>
        {!preview && (
          <aside className={styles.leftPanel}>
            <section>
              <div className={styles.panelTitle}><Plus size={14} /> ЭЛЕМЕНТЫ</div>
              <div className={styles.toolGrid}>
                <button onClick={() => addElement("text")}><Type size={20} /><span>Текст</span></button>
                <button onClick={() => addElement("button")}><MousePointer2 size={20} /><span>Кнопка</span></button>
                <button onClick={() => addElement("image")}><ImageIcon size={20} /><span>Фото</span></button>
                <button onClick={() => addElement("box")}><Square size={20} /><span>Блок</span></button>
              </div>
            </section>

            <section className={styles.layersSection}>
              <div className={styles.panelTitle}><Layers3 size={14} /> СЛОИ</div>
              <div className={styles.layers}>
                {[...elements].reverse().map((element) => (
                  <button
                    key={element.id}
                    className={element.id === selectedId ? styles.layerActive : ""}
                    onClick={() => setSelectedId(element.id)}
                  >
                    <span className={styles.layerIcon}>
                      {element.kind === "text" && <Type size={13} />}
                      {element.kind === "button" && <MousePointer2 size={13} />}
                      {element.kind === "image" && <ImageIcon size={13} />}
                      {element.kind === "box" && <Box size={13} />}
                    </span>
                    <span>{element.name}</span>
                  </button>
                ))}
              </div>
            </section>

            <button className={styles.resetButton} onClick={resetProject}>
              <RotateCcw size={14} /> Сбросить макет
            </button>
          </aside>
        )}

        <section className={styles.center}>
          <div className={styles.canvasToolbar}>
            <div className={styles.deviceGroup}>
              <button
                className={viewport === "desktop" ? styles.deviceActive : ""}
                onClick={() => setViewport("desktop")}
                title="Компьютер"
              ><Monitor size={16} /></button>
              <button
                className={viewport === "tablet" ? styles.deviceActive : ""}
                onClick={() => setViewport("tablet")}
                title="Планшет"
              ><Tablet size={16} /></button>
              <button
                className={viewport === "mobile" ? styles.deviceActive : ""}
                onClick={() => setViewport("mobile")}
                title="Телефон"
              ><Smartphone size={16} /></button>
            </div>
            <div className={styles.canvasMeta}>{canvasWidth}px · {pageHeight}px</div>
            <label className={styles.zoomControl}>
              <span>Масштаб</span>
              <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
                <option value={0.5}>50%</option>
                <option value={0.65}>65%</option>
                <option value={0.75}>75%</option>
                <option value={0.9}>90%</option>
                <option value={1}>100%</option>
              </select>
            </label>
          </div>

          <div className={styles.canvasScroller}>
            <div
              className={styles.canvasScaleBox}
              style={{ width: canvasWidth * zoom, height: pageHeight * zoom }}
            >
              <div
                ref={canvasRef}
                className={styles.canvas}
                style={{
                  width: canvasWidth,
                  height: pageHeight,
                  background: pageBackground,
                  transform: `scale(${zoom})`,
                }}
                onPointerDown={() => setSelectedId(null)}
              >
                <div className={styles.gridOverlay} />
                {elements.map((element, index) => (
                  <div
                    key={element.id}
                    className={`${styles.canvasElement} ${
                      element.id === selectedId && !preview ? styles.selectedElement : ""
                    }`}
                    style={elementCss(element, index)}
                    onPointerDown={(event) => beginDrag(event, element)}
                  >
                    {element.kind === "image" ? (
                      element.src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={element.src} alt="" draggable={false} />
                      ) : (
                        <div className={styles.imagePlaceholder}>
                          <ImageIcon size={28} />
                          <span>Добавь ссылку на фото справа</span>
                        </div>
                      )
                    ) : element.kind === "box" ? null : (
                      <span>{element.text}</span>
                    )}
                    {element.id === selectedId && !preview && (
                      <span className={styles.selectionTag}>{element.name}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {!preview && (
          <aside className={styles.rightPanel}>
            {selected ? (
              <>
                <div className={styles.inspectorHeader}>
                  <div>
                    <span>ВЫБРАНО</span>
                    <strong>{selected.name}</strong>
                  </div>
                  <div className={styles.miniActions}>
                    <button onClick={duplicateSelected} title="Дублировать"><Copy size={14} /></button>
                    <button onClick={deleteSelected} title="Удалить"><Trash2 size={14} /></button>
                  </div>
                </div>

                <div className={styles.inspectorScroll}>
                  <section className={styles.inspectorSection}>
                    <label className={styles.fieldFull}>
                      <span>Название слоя</span>
                      <input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} />
                    </label>

                    {(selected.kind === "text" || selected.kind === "button") && (
                      <label className={styles.fieldFull}>
                        <span>Текст</span>
                        <textarea value={selected.text} onChange={(event) => updateSelected({ text: event.target.value })} />
                      </label>
                    )}

                    {selected.kind === "image" && (
                      <label className={styles.fieldFull}>
                        <span>Ссылка на изображение</span>
                        <input
                          value={selected.src}
                          onChange={(event) => updateSelected({ src: event.target.value })}
                          placeholder="https://..."
                        />
                      </label>
                    )}

                    {selected.kind === "button" && (
                      <label className={styles.fieldFull}>
                        <span>Ссылка кнопки</span>
                        <input value={selected.href} onChange={(event) => updateSelected({ href: event.target.value })} />
                      </label>
                    )}
                  </section>

                  <section className={styles.inspectorSection}>
                    <div className={styles.sectionLabel}>ПОЗИЦИЯ И РАЗМЕР</div>
                    <div className={styles.fieldGrid}>
                      <NumberField label="X" value={selected.x} onChange={(x) => updateSelected({ x })} />
                      <NumberField label="Y" value={selected.y} onChange={(y) => updateSelected({ y })} />
                      <NumberField label="Ширина" value={selected.width} min={20} onChange={(width) => updateSelected({ width })} />
                      <NumberField label="Высота" value={selected.height} min={20} onChange={(height) => updateSelected({ height })} />
                    </div>
                  </section>

                  <section className={styles.inspectorSection}>
                    <div className={styles.sectionLabel}>СТИЛЬ</div>
                    <ColorField label="Фон" value={selected.style.background} onChange={(background) => updateSelectedStyle({ background })} />
                    {selected.kind !== "box" && selected.kind !== "image" && (
                      <ColorField label="Текст" value={selected.style.color} onChange={(color) => updateSelectedStyle({ color })} />
                    )}
                    <ColorField label="Граница" value={selected.style.borderColor} onChange={(borderColor) => updateSelectedStyle({ borderColor })} />
                    <div className={styles.fieldGrid}>
                      <NumberField label="Радиус" value={selected.style.borderRadius} min={0} onChange={(borderRadius) => updateSelectedStyle({ borderRadius })} />
                      <NumberField label="Граница" value={selected.style.borderWidth} min={0} onChange={(borderWidth) => updateSelectedStyle({ borderWidth })} />
                    </div>

                    {(selected.kind === "text" || selected.kind === "button") && (
                      <>
                        <div className={styles.fieldGrid}>
                          <NumberField label="Шрифт" value={selected.style.fontSize} min={8} onChange={(fontSize) => updateSelectedStyle({ fontSize })} />
                          <NumberField label="Жирность" value={selected.style.fontWeight} min={100} step={100} onChange={(fontWeight) => updateSelectedStyle({ fontWeight })} />
                        </div>
                        <div className={styles.alignGroup}>
                          {(["left", "center", "right"] as TextAlign[]).map((align) => (
                            <button
                              key={align}
                              className={selected.style.textAlign === align ? styles.alignActive : ""}
                              onClick={() => updateSelectedStyle({ textAlign: align })}
                            >
                              {align === "left" ? "Слева" : align === "center" ? "Центр" : "Справа"}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </section>

                  <section className={styles.inspectorSection}>
                    <div className={styles.sectionLabel}>СЛОЙ</div>
                    <div className={styles.layerMoveActions}>
                      <button onClick={() => moveLayer(selected.id, 1)}><ChevronUp size={14} /> Выше</button>
                      <button onClick={() => moveLayer(selected.id, -1)}><ChevronDown size={14} /> Ниже</button>
                    </div>
                  </section>
                </div>
              </>
            ) : (
              <div className={styles.pageInspector}>
                <div className={styles.inspectorHeader}>
                  <div><span>СТРАНИЦА</span><strong>Настройки холста</strong></div>
                </div>
                <div className={styles.inspectorSection}>
                  <ColorField label="Фон страницы" value={pageBackground} onChange={setPageBackground} />
                  <NumberField label="Высота страницы" value={pageHeight} min={500} step={50} onChange={setPageHeight} />
                </div>
                <div className={styles.emptyHint}>
                  <MousePointer2 size={22} />
                  <strong>Выбери элемент</strong>
                  <span>Кликни по объекту на холсте, чтобы менять его параметры.</span>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
}) {
  return (
    <label className={styles.numberField}>
      <span>{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        min={min}
        step={step}
        onChange={(event) => {
          const number = Number(event.target.value);
          if (Number.isFinite(number)) onChange(Math.max(min, number));
        }}
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const pickerValue = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <label className={styles.colorField}>
      <span>{label}</span>
      <div>
        <input type="color" value={pickerValue} onChange={(event) => onChange(event.target.value)} />
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </label>
  );
}
