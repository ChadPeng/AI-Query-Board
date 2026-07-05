import type { Metadata } from "next";
import { Orbitron, Share_Tech_Mono, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// Cyberpunk/glitch design system font stack. CJK glyphs (this app's UI copy is
// zh-Hant) fall back per-character to the system CJK font declared in
// globals.css — only Latin letters/numbers/labels render in these faces.
const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  variable: "--font-heading",
  display: "swap",
});
const shareTechMono = Share_Tech_Mono({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-accent",
  display: "swap",
});
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI 數據儀表板",
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
      className={`${orbitron.variable} ${shareTechMono.variable} ${jetBrainsMono.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
