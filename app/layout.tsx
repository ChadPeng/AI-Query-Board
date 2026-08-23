import type { Metadata } from "next";
import { IBM_Plex_Sans, Noto_Sans_TC, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// 冷靜專業風（深色資料介面）字體組：Latin 用 IBM Plex Sans、CJK 落到
// Noto Sans TC，SQL 與數字用 JetBrains Mono（表格數字配 tabular-nums）。
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});
const notoSansTC = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-tc",
  display: "swap",
});
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "QueryBoard — AI 數據分析",
  description: "用自然語言問數據問題，AI 產生圖表",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-Hant"
      className={`${plexSans.variable} ${notoSansTC.variable} ${jetBrainsMono.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
