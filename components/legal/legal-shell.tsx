import type { ReactNode } from "react";
import Link from "next/link";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { Container } from "@/components/marketing/container";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/support";

/**
 * The shell both legal pages sit in.
 *
 * Narrower than the marketing container on purpose. These are the only pages on
 * the site somebody reads top to bottom rather than scans, and a 6xl measure at
 * this body size runs to well over a hundred characters a line, which is where
 * people stop reading and start skimming a document they are agreeing to.
 */
export function LegalShell({
  title,
  lastUpdated,
  summary,
  children,
}: {
  title: string;
  lastUpdated: string;
  /** The honest one-paragraph version, for the many people who read only this. */
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas">
      <Nav />
      <main className="py-16 sm:py-24">
        <Container>
          <div className="mx-auto max-w-2xl">
            <h1 className="font-display text-3xl text-paper sm:text-4xl">{title}</h1>
            <p className="mt-3 text-sm text-muted">Last updated {lastUpdated}</p>

            <div className="mt-8 rounded-2xl border border-canvas-line bg-canvas-raised p-6">
              <h2 className="text-sm font-medium text-volt">The short version</h2>
              <div className="mt-2 text-sm leading-relaxed text-paper/90">{summary}</div>
            </div>

            <div className="legal-prose mt-12">{children}</div>

            <div className="mt-16 border-t border-canvas-line pt-8 text-sm text-muted">
              <p>
                Questions about anything here? Call{" "}
                <a
                  href={SUPPORT_PHONE_HREF}
                  className="text-paper transition-colors hover:text-volt focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-volt"
                >
                  {SUPPORT_PHONE}
                </a>
                .
              </p>
              <p className="mt-3">
                <Link
                  href="/"
                  className="text-paper transition-colors hover:text-volt focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-volt"
                >
                  Back to Klik
                </Link>
              </p>
            </div>
          </div>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
