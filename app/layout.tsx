import type { Metadata, Viewport } from "next";
import { Courier_Prime, Hanken_Grotesk, Instrument_Serif } from "next/font/google";
import "./globals.css";

const display = Instrument_Serif({ weight: "400", subsets: ["latin"], variable: "--font-display-face", display: "swap" });
const body = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-body-face", display: "swap" });
const typewriter = Courier_Prime({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-typewriter-face",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Handback: the deposit that settles itself",
  description:
    "A rental's PayPal hold is released, or partly captured, by an AI agent that compares photos of the item at pickup and at return.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ebe3d0" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${typewriter.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-ink focus:px-3 focus:py-2 focus:text-paper"
        >
          Skip to content
        </a>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
