import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Khasroy Trading",
  description: "Живой график Binance Futures, анализ Хасроя по правилам, журнал сигналов и бумажный кошелёк.",
};

export default function TradingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
