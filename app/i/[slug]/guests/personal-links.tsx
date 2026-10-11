"use client";

import { useMemo, useState } from "react";
import { parseGuestList, personalLink, whatsappShare } from "@/lib/invitations/share";
import styles from "./guests.module.css";

export function PersonalLinks({ slug, title }: { slug: string; title: string }) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState("");
  const names = useMemo(() => parseGuestList(text), [text]);
  const links = names.map((name) => ({ name, url: personalLink(slug, name) }));

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("");
    }
  }

  return (
    <div className={styles.links}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Асан байке\nАйгуль эже\nНурлан"}
        rows={5}
        aria-label="Имена гостей"
      />
      {links.length ? (
        <>
          <button
            type="button"
            className={styles.button}
            onClick={() => copy(links.map((l) => `${l.name}: ${l.url}`).join("\n"), "all")}
          >
            {copied === "all" ? "Скопировано" : `Скопировать все (${links.length})`}
          </button>
          <ul>
            {links.map((l) => (
              <li key={l.url}>
                <span>{l.name}</span>
                <button type="button" onClick={() => copy(l.url, l.url)}>{copied === l.url ? "Скопировано" : "Ссылка"}</button>
                <a href={whatsappShare(`${l.name}, приглашаем вас! ${title}\n${l.url}`)} target="_blank" rel="noopener noreferrer">WhatsApp</a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
