import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codex Chat 结果传递测试",
  description: "仅用于合成测试文本的提交与精确读回。",
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
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
