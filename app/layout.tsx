import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://dynastyranks.com",
  ),
  title: "DynastyRanks - League-Specific Dynasty Rankings",
  description:
    "Custom dynasty rankings and trade values for YOUR league settings. The only tool that truly understands IDP, custom scoring, and unique roster configurations.",
  openGraph: {
    title: "DynastyRanks - League-Specific Dynasty Rankings",
    description:
      "Custom dynasty rankings and trade values for YOUR league settings. IDP support, custom scoring, and unique roster configurations.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "DynastyRanks - League-Specific Dynasty Rankings",
    description:
      "Custom dynasty rankings and trade values for YOUR league settings. IDP support, custom scoring, and unique roster configurations.",
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
      <body className={inter.className}>
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
