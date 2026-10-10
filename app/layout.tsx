import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Хасрой — онлайн-приглашения",
  description:
    "Хасрой создаёт онлайн-приглашения на свадьбу, тушоо той, кыз узатуу, день рождения и другие события через простой разговор.",
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
