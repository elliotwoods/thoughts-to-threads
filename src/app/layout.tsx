import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Thoughts to Threads",
  description:
    "Auto-publish thoughts from Microsoft To Do to Threads, one per day.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="brand">
              Thoughts to Threads
            </Link>
            <nav className="nav">
              <Link href="/">Dashboard</Link>
              <Link href="/thoughts">Thoughts</Link>
              <Link href="/settings">Settings</Link>
              <Link href="/connections">Connections</Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
