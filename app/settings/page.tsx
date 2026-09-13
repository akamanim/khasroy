"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, KeyRound, Link2, ShieldCheck, Trash2 } from "lucide-react";
import { authenticateOwner } from "@/lib/chat";

type Provider = "github" | "vercel" | "instagram" | "groq" | "openai" | "gemini" | "kimi";
type ProviderStatus = { id: Provider; configured: boolean };

type IntegrationResponse = {
  ok?: boolean;
  providers?: ProviderStatus[];
  error?: string;
};

const LABELS: Record<Provider, { title: string; hint: string; config?: "instagram" }> = {
  github: { title: "GitHub", hint: "Токен с правом создавать и изменять репозитории." },
  vercel: { title: "Vercel", hint: "Access Token для создания проектов и production deploy." },
  instagram: { title: "Instagram", hint: "Graph API access token + Business Account ID.", config: "instagram" },
  groq: { title: "Groq", hint: "Основной быстрый AI-провайдер." },
  openai: { title: "OpenAI", hint: "Резервный/сильный AI-провайдер." },
  gemini: { title: "Gemini", hint: "AI-провайдер для long-context и research задач." },
  kimi: { title: "Kimi", hint: "Дополнительный AI-провайдер." },
};

export default function SettingsPage() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [ownerKey, setOwnerKey] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState<Provider | "auth" | null>(null);
  const [secret, setSecret] = useState<Partial<Record<Provider, string>>>({});
  const [instagramId, setInstagramId] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/integrations", { credentials: "include", cache: "no-store" });
      if (response.status === 401) {
        setAuthRequired(true);
        return;
      }
      const data = await response.json().catch(() => ({})) as IntegrationResponse;
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить интеграции");
      setProviders(data.providers || []);
      setAuthRequired(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить интеграции");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!ownerKey.trim() || busy) return;
    setBusy("auth");
    setAuthError("");
    try {
      const ok = await authenticateOwner(ownerKey.trim());
      if (!ok) {
        setAuthError("Неверный ключ владельца.");
        return;
      }
      setOwnerKey("");
      await load();
    } catch {
      setAuthError("Не удалось проверить ключ владельца.");
    } finally {
      setBusy(null);
    }
  }

  async function save(provider: Provider) {
    const value = secret[provider]?.trim() || "";
    if (value.length < 8) {
      setMessage(`Введите действующий секрет для ${LABELS[provider].title}.`);
      return;
    }
    if (provider === "instagram" && !instagramId.trim()) {
      setMessage("Для Instagram нужен Business Account ID.");
      return;
    }
    setBusy(provider);
    setMessage("");
    try {
      const response = await fetch("/api/integrations", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          secret: value,
          config: provider === "instagram" ? { businessAccountId: instagramId.trim() } : {},
        }),
      });
      const data = await response.json().catch(() => ({})) as IntegrationResponse;
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить интеграцию");
      setSecret((previous) => ({ ...previous, [provider]: "" }));
      if (provider === "instagram") setInstagramId("");
      setMessage(`${LABELS[provider].title} подключён. Секрет зашифрован и сохранён.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить интеграцию");
    } finally {
      setBusy(null);
    }
  }

  async function remove(provider: Provider) {
    setBusy(provider);
    setMessage("");
    try {
      const response = await fetch("/api/integrations", {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (!response.ok) throw new Error("Не удалось удалить интеграцию");
      setMessage(`${LABELS[provider].title} отключён.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось удалить интеграцию");
    } finally {
      setBusy(null);
    }
  }

  const configured = new Set(providers.filter((item) => item.configured).map((item) => item.id));

  return (
    <main style={{ minHeight: "100vh", padding: "28px 18px 70px", background: "#061017", color: "#dff8ff" }}>
      <div style={{ width: "min(920px,100%)", margin: "0 auto" }}>
        <a href="/" style={{ display: "inline-flex", gap: 8, alignItems: "center", color: "#8db4c1", textDecoration: "none", fontSize: 13, marginBottom: 24 }}>
          <ArrowLeft size={16} /> Назад к Хасрою
        </a>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <ShieldCheck size={27} />
          <h1 style={{ margin: 0, fontSize: 28 }}>Интеграции Хасроя</h1>
        </div>
        <p style={{ margin: "0 0 30px", color: "#7f9eaa", lineHeight: 1.6 }}>
          Здесь один раз подключаются сервисы, которыми Хасрой сможет пользоваться сам. Секреты не отображаются после сохранения и хранятся в зашифрованном vault.
        </p>

        {authRequired ? (
          <form onSubmit={login} style={{ maxWidth: 480, border: "1px solid #203945", borderRadius: 18, padding: 22, background: "#0a1820" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}><KeyRound size={20} /><strong>Доступ владельца</strong></div>
            <input type="password" value={ownerKey} onChange={(event) => setOwnerKey(event.target.value)} placeholder="KHASROY_OWNER_KEY" autoFocus style={inputStyle} />
            {authError && <p style={{ color: "#ff9292", fontSize: 13 }}>{authError}</p>}
            <button disabled={!ownerKey.trim() || busy === "auth"} style={primaryButton}>{busy === "auth" ? "Проверяю…" : "Войти"}</button>
          </form>
        ) : (
          <>
            {loading ? <p style={{ color: "#7f9eaa" }}>Проверяю подключения…</p> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 }}>
                {(Object.keys(LABELS) as Provider[]).map((provider) => {
                  const isConfigured = configured.has(provider);
                  return (
                    <section key={provider} style={{ border: `1px solid ${isConfigured ? "#2a665f" : "#203945"}`, borderRadius: 18, padding: 20, background: "#0a1820" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}><Link2 size={18} /><strong>{LABELS[provider].title}</strong></div>
                        <span style={{ fontSize: 11, color: isConfigured ? "#82d9c9" : "#66828e" }}>{isConfigured ? "ПОДКЛЮЧЁН" : "НЕ ПОДКЛЮЧЁН"}</span>
                      </div>
                      <p style={{ minHeight: 42, color: "#7896a2", fontSize: 13, lineHeight: 1.5 }}>{LABELS[provider].hint}</p>
                      <input type="password" value={secret[provider] || ""} onChange={(event) => setSecret((previous) => ({ ...previous, [provider]: event.target.value }))} placeholder={isConfigured ? "Новый секрет (если хотите заменить)" : "Access token / API key"} autoComplete="new-password" style={inputStyle} />
                      {provider === "instagram" && <input value={instagramId} onChange={(event) => setInstagramId(event.target.value)} placeholder="Instagram Business Account ID" style={{ ...inputStyle, marginTop: 9 }} />}
                      <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
                        <button onClick={() => void save(provider)} disabled={busy !== null || !(secret[provider] || "").trim()} style={primaryButton} type="button">
                          {busy === provider ? "Сохраняю…" : isConfigured ? "Обновить" : "Подключить"}
                        </button>
                        {isConfigured && <button onClick={() => void remove(provider)} disabled={busy !== null} style={dangerButton} type="button" aria-label={`Отключить ${LABELS[provider].title}`}><Trash2 size={16} /></button>}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}

            {message && <div style={{ marginTop: 18, border: "1px solid #24434d", borderRadius: 12, padding: "12px 14px", background: "#0b1b23", color: "#9ed0d9", display: "flex", gap: 9, alignItems: "center" }}><CheckCircle2 size={17} />{message}</div>}
          </>
        )}
      </div>
    </main>
  );
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  border: "1px solid #29434f",
  borderRadius: 11,
  background: "#07131a",
  color: "#e2f7fb",
  padding: "12px 13px",
  outline: "none",
  fontSize: 14,
};

const primaryButton = {
  border: 0,
  borderRadius: 10,
  background: "#8adbea",
  color: "#041016",
  padding: "11px 14px",
  fontWeight: 750,
  cursor: "pointer",
};

const dangerButton = {
  border: "1px solid #5d3238",
  borderRadius: 10,
  background: "#251318",
  color: "#ff9ba6",
  padding: "10px 12px",
  cursor: "pointer",
};
