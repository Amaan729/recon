import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { SessionProvider } from "next-auth/react";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MailSuite Pro",
  description: "Email tracking, mail merge, scheduling & follow-up sequences",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SessionProvider>
          {children}
          <Toaster richColors />
        </SessionProvider>
      </body>
    </html>
  );
}
