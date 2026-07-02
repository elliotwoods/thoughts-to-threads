import type { Metadata } from "next";
import { EB_Garamond, Hanken_Grotesk } from "next/font/google";
import Link from "next/link";
import "./globals.css";

// The writing is set in EB Garamond (serif), the chrome in Hanken Grotesk
// (sans). Both are exposed to globals.css as --serif / --sans.
const serif = EB_Garamond({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--serif",
  display: "swap",
});
const sans = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--sans",
  display: "swap",
});

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
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
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
              <form action="/api/auth/signout" method="POST" style={{ display: "contents" }}>
                <button type="submit">Sign out</button>
              </form>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
