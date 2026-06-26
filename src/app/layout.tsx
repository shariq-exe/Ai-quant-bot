import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "QUANT·DESK — EUR/USD & XAU/USD Quant Trading System",
  description: "Deep-research-to-execution quantitative trading system: regime-aware market data, validated strategies (p<0.05), live signals, TradingView charts.",
  keywords: ["quantitative trading", "EUR/USD", "XAU/USD", "backtesting", "alpha", "Sharpe", "TradingView"],
  authors: [{ name: "QUANT·DESK" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "QUANT·DESK",
    description: "Quantitative trading system for EUR/USD & XAU/USD",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
