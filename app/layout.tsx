import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Хасрой v0.2 — Evolving Code Intelligence",
  description:
    "Хасрой — развивающаяся AI-система для диалога, программирования, анализа кода и будущего автономного исследования технологий.",
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
