import Image from "next/image";
import Link from "next/link";
import { Container } from "./container";
import { CtaLink } from "./cta-link";

export function Nav() {
  return (
    <header className="relative z-10">
      <Container className="flex items-center justify-between py-6">
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
            className="hidden text-sm text-muted transition-colors hover:text-paper sm:block"
          >
            Log in
          </Link>
          <CtaLink href="/login" size="md">
            Create your event
          </CtaLink>
        </nav>
      </Container>
    </header>
  );
}
