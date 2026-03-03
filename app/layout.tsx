import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://mydynastyvalues.com",
  ),
  title: "MyDynastyValues - Your League. Your Values.",
  description:
    "Dynasty values and trade analysis for YOUR league settings. The only tool that truly understands IDP, custom scoring, and unique roster configurations.",
  openGraph: {
    title: "MyDynastyValues - Your League. Your Values.",
    description:
      "Dynasty values and trade analysis for YOUR league settings. IDP support, custom scoring, and unique roster configurations.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "MyDynastyValues - Your League. Your Values.",
    description:
      "Dynasty values and trade analysis for YOUR league settings. IDP support, custom scoring, and unique roster configurations.",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${outfit.variable} font-sans`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          Skip to main content
        </a>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
