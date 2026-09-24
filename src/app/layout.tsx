import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kynva Enterprise AI Knowledge Base",
  description: "Secure RAG Document Intelligence Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="el">
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#090d16] text-slate-100`}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
