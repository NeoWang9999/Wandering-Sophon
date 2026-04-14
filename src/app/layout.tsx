import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "流浪智子深空",
  description: "认领一颗流浪智子，给它一个归处",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
