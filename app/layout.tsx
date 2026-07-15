import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { AuditProvider } from "@/lib/state/AuditContext";
import { AppShell } from "@/components/AppShell";
import { themeInitScript } from "@/components/ThemeToggle";

const SITE_URL = "https://seo-audit-dashboard-topaz.vercel.app";
const SITE_NAME = "SEO Technical Audit Dashboard";
const SITE_DESCRIPTION = "Enterprise-grade SEO technical audit tool";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["SEO audit", "technical SEO", "site health", "crawlability", "on-page SEO", "Core Web Vitals"],
  // Internal tool: not meant for public search results (see app/robots.ts
  // for the matching robots.txt disallow-all).
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#6366F1",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // proxy.ts stamps a per-request CSP nonce on the request headers;
  // this inline script needs it or the CSP's script-src blocks it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--seo-app-bg)] text-[var(--seo-text)]">
        <AuditProvider>
          <AppShell>{children}</AppShell>
        </AuditProvider>
      </body>
    </html>
  );
}
