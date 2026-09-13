import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Хасрой v0.4 — Evolving Code Intelligence",
  description:
    "Хасрой — развивающаяся AI-система с долговременной памятью и проверенным чтением собственного GitHub-кода.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">
        {children}
        <a
          href="/settings"
          aria-label="Интеграции Хасроя"
          style={{
            position: "fixed",
            right: 18,
            bottom: 18,
            zIndex: 900,
            border: "1px solid rgba(126, 216, 231, .25)",
            borderRadius: 999,
            background: "rgba(7, 20, 27, .9)",
            color: "#9bdbe5",
            padding: "10px 14px",
            textDecoration: "none",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: ".04em",
            backdropFilter: "blur(12px)",
            boxShadow: "0 8px 30px rgba(0,0,0,.25)",
          }}
        >
          ⚙ Интеграции
        </a>
      </body>
    </html>
  );
}
