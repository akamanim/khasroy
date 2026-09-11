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
      <body className="antialiased">{children}</body>
    </html>
  );
}
