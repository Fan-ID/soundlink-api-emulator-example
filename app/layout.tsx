import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getWallet, readDemo } from "@/lib/emulator";
import "./globals.css";

export const metadata: Metadata = {
  title: "Soundlink API emulator",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const result = await readDemo();
  if (!("demo" in result)) {
    return (
      <html lang="en">
        <body>
          <main>
            <h1>Emulator did not start</h1>
            <p>{result.message}</p>
          </main>
        </body>
      </html>
    );
  }

  const wallet = await getWallet(result.demo.soundlink);

  return (
    <html lang="en">
      <body>
        <header>
          <div className="bar">
            <Link className="brand" href="/">
              Soundlink API emulator
            </Link>
            <p className="wallet">
              Balance {wallet.balance} · available {wallet.available} · reserved{" "}
              {wallet.reserved}
            </p>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
