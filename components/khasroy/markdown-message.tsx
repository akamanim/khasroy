import { Fragment, type ReactNode } from "react";
import styles from "./markdown-message.module.css";

function safeHref(value: string) {
  const href = value.trim();
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href;
  return null;
}

function safeImageSrc(value: string) {
  const src = value.trim();
  if (/^https?:\/\//i.test(src)) return src;
  if (/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(src)) return src;
  return null;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^\)\n]+\)|\*[^*\n]+\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      tokens.push(text.slice(cursor, match.index));
    }

    const value = match[0];
    const key = `${keyPrefix}-${index++}`;

    if (value.startsWith("**")) {
      tokens.push(<strong key={key}>{value.slice(2, -2)}</strong>);
    } else if (value.startsWith("`")) {
      tokens.push(<code key={key}>{value.slice(1, -1)}</code>);
    } else if (value.startsWith("[")) {
      const link = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = link ? safeHref(link[2]) : null;
      if (link && href) {
        tokens.push(
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {link[1]}
          </a>,
        );
      } else {
        tokens.push(value);
      }
    } else if (value.startsWith("*")) {
      tokens.push(<em key={key}>{value.slice(1, -1)}</em>);
    } else {
      tokens.push(value);
    }

    cursor = match.index + value.length;
  }

  if (cursor < text.length) tokens.push(text.slice(cursor));
  return tokens;
}

function splitTableRow(line: string) {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  return value.split("|").map((cell) => cell.trim());
}

function isTableDivider(line: string) {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function isHorizontalRule(line: string) {
  return /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line);
}

function isListLine(line: string) {
  return /^\s*[-+*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line);
}

function isImageLine(line: string) {
  return /^!\[[^\]\n]*\]\(.+\)$/.test(line.trim());
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  return (
    !line.trim() ||
    /^\s*```/.test(line) ||
    /^\s{0,3}#{1,3}\s+/.test(line) ||
    /^\s*>\s?/.test(line) ||
    isHorizontalRule(line) ||
    isListLine(line) ||
    isImageLine(line) ||
    (line.includes("|") && isTableDivider(next))
  );
}

export function MarkdownMessage({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let block = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```([^`]*)$/);
    if (fence) {
      const language = fence[1].trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code-${block++}`}>
          {language && <span className={styles.codeLanguage}>{language}</span>}
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const image = line.trim().match(/^!\[([^\]\n]*)\]\((.+)\)$/);
    if (image) {
      const src = safeImageSrc(image[2]);
      if (src) {
        blocks.push(
          <figure
            key={`image-${block++}`}
            style={{
              margin: "14px 0 10px",
              width: "100%",
              maxWidth: 760,
            }}
          >
            {/* Generated images may arrive as data URLs, so Next/Image is not appropriate here. */}
            <img
              src={src}
              alt={image[1] || "Сгенерированное изображение"}
              loading="eager"
              style={{
                display: "block",
                width: "100%",
                height: "auto",
                maxHeight: "72vh",
                objectFit: "contain",
                borderRadius: 18,
                border: "1px solid rgba(118, 215, 235, 0.22)",
                boxShadow: "0 18px 58px rgba(0, 0, 0, 0.36)",
                background: "rgba(2, 8, 12, 0.76)",
              }}
            />
            <figcaption
              style={{
                marginTop: 8,
                color: "rgba(190, 222, 232, 0.56)",
                fontSize: 11,
                letterSpacing: ".04em",
              }}
            >
              KHASROY IMAGE LAB
            </figcaption>
          </figure>,
        );
        index += 1;
        continue;
      }
    }

    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const children = renderInline(heading[2].trim(), `heading-${block}`);
      if (level === 1) blocks.push(<h1 key={`h-${block++}`}>{children}</h1>);
      else if (level === 2) blocks.push(<h2 key={`h-${block++}`}>{children}</h2>);
      else blocks.push(<h3 key={`h-${block++}`}>{children}</h3>);
      index += 1;
      continue;
    }

    if (line.includes("|") && isTableDivider(lines[index + 1] ?? "")) {
      const headers = splitTableRow(line);
      const divider = splitTableRow(lines[index + 1]);
      const alignments = divider.map((cell) => {
        const compact = cell.replace(/\s+/g, "");
        if (compact.startsWith(":") && compact.endsWith(":")) return "center" as const;
        if (compact.endsWith(":")) return "right" as const;
        return "left" as const;
      });
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }

      blocks.push(
        <div className={styles.tableWrap} key={`table-${block++}`}>
          <table>
            <thead>
              <tr>
                {headers.map((cell, cellIndex) => (
                  <th key={cellIndex} style={{ textAlign: alignments[cellIndex] ?? "left" }}>
                    {renderInline(cell, `th-${block}-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {headers.map((_, cellIndex) => (
                    <td key={cellIndex} style={{ textAlign: alignments[cellIndex] ?? "left" }}>
                      {renderInline(row[cellIndex] ?? "", `td-${block}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${block++}`}>
          <p>{renderInline(quote.join(" "), `quote-inline-${block}`)}</p>
        </blockquote>,
      );
      continue;
    }

    if (isListLine(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const currentOrdered = /^\s*\d+[.)]\s+/.test(current);
        const currentUnordered = /^\s*[-+*]\s+/.test(current);
        if (ordered ? !currentOrdered : !currentUnordered) break;
        items.push(
          current.replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-+*]\s+/, "").trim(),
        );
        index += 1;
      }
      const listItems = items.map((item, itemIndex) => (
        <li key={itemIndex}>{renderInline(item, `li-${block}-${itemIndex}`)}</li>
      ));
      blocks.push(
        ordered ? (
          <ol key={`list-${block++}`}>{listItems}</ol>
        ) : (
          <ul key={`list-${block++}`}>{listItems}</ul>
        ),
      );
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push(<hr key={`hr-${block++}`} />);
      index += 1;
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={`p-${block++}`}>
        {renderInline(paragraph.join(" "), `p-inline-${block}`)}
      </p>,
    );
  }

  return <div className={styles.markdown}>{blocks.map((item, i) => <Fragment key={i}>{item}</Fragment>)}</div>;
}
