import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Διαχείριση & Ανάλυση Εγγράφων | Kynva",
  description: "Οργανώστε τα αρχεία σας με απλές εντολές και αναλύστε τα έγγραφά σας σε δευτερόλεπτα.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="el">
        <body className={inter.className}>{children}</body>
      </html>
    </ClerkProvider>
  );
}
