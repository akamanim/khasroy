import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Хасрой v0.1 — Персональный AI-ассистент",
  description: "Живое AI-ядро и пространство для диалога. Локальный прототип Хасрой v0.1.",
  other: {
    "codex-preview": "development",
  },
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
