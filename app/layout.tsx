import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "知序 · 个人知识库",
  description: "收集有价值的资料，让想法有据可循。",
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
