import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Daylight — Make room for what matters",
  description:
    "A calm place to plan your time, move projects forward, and see what matters next.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
