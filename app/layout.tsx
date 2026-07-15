import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { AuditProvider } from "@/lib/state/AuditContext";
import { AppShell } from "@/components/AppShell";
import { themeInitScript } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "SEO Technical Audit Dashboard",
  description: "Enterprise-grade SEO technical audit tool",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // middleware.ts stamps a per-request CSP nonce on the request headers;
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
