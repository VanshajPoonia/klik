import Image from "next/image";
import Link from "next/link";
import { Container } from "./container";
import { CtaLink } from "./cta-link";

export function Nav() {
  return (
    // Sticky, so "Create your event" is one tap away from anywhere on the page.
    // The blur is there for legibility over the reel, not as decoration.
    <header className="sticky top-0 z-40 border-b border-canvas-line/60 bg-canvas/75 backdrop-blur-md">
      <Container className="flex items-center justify-between py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/klik-mark.png"
            alt=""
            width={30}
            height={30}
            className="rounded-[8px]"
            priority
          />
          <span className="text-lg font-semibold tracking-tight text-paper">klik</span>
        </Link>
        <nav className="flex items-center gap-5">
          <Link
            href="/#pricing"
            className="hidden text-sm text-muted transition-colors hover:text-paper md:block"
          >
            Pricing
          </Link>
          <Link
            href="/login"
            className="text-sm text-muted transition-colors hover:text-paper"
          >
            Log in
          </Link>
          <CtaLink href="/signup" size="md">
            Create your event
          </CtaLink>
        </nav>
      </Container>
    </header>
  );
}
