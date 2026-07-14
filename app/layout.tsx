import type { Metadata } from "next";
import "./globals.css";
import { AuditProvider } from "@/lib/state/AuditContext";
import { AppShell } from "@/components/AppShell";
import { themeInitScript } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "SEO Technical Audit Dashboard",
  description: "Enterprise-grade SEO technical audit tool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--seo-app-bg)] text-[var(--seo-text)]">
        <AuditProvider>
          <AppShell>{children}</AppShell>
        </AuditProvider>
      </body>
    </html>
  );
}
