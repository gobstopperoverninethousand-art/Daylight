import type { Metadata } from "next";
import "./globals.css";
import "./experiences.css";
import "./experiences-extra.css";
import "./experiences-extra2.css";
import "./original.css";

export const metadata: Metadata = {
  title: "Daylight — Make room for what matters",
  description:
    "A calm place to plan your time, move projects forward, and see what matters next.",
  openGraph: {
    title: "Daylight — Make room for what matters",
    description:
      "A calm place to plan your time, move projects forward, and see what matters next.",
  },
};

const experienceInitScript = `
(function() {
  try {
    var valid = ["original","broadsheet","cockpit","bauhaus","flow","zen","sundial","timeline","terminal","retro98","mission","transit","blueprint","notebook","gallery","constellation","synth","zine","arena"];
    var params = new URLSearchParams(window.location.search);
    var q = params.get("style");
    var stored = localStorage.getItem("daylight:experience");
    var chosen = valid.indexOf(q) !== -1 ? q : (valid.indexOf(stored) !== -1 ? stored : "original");
    document.documentElement.dataset.experience = chosen;
  } catch (e) {
    document.documentElement.dataset.experience = "original";
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-experience="original" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..700&family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400..700&family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..600&family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: experienceInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
