import type { Metadata } from "next";
import "./globals.css";
import { RelayProvider } from "@/hooks/useRelayStore";

export const metadata: Metadata = {
  title: "RELAY AI — Beyond Prompts. Into Collaboration.",
  description:
    "RELAY AI is an intelligent human-agent collaboration platform that enables people to coordinate, supervise and interact with multiple AI agents through an adaptive, transparent and human-controlled workflow.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground font-sans antialiased selection:bg-violet-500/30 selection:text-white">
        <RelayProvider>{children}</RelayProvider>
      </body>
    </html>
  );
}
