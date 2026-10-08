import Image from "next/image";
import Link from "next/link";
import { Container } from "./container";

export function Footer() {
  return (
    <footer className="bg-canvas py-12">
      <Container className="flex flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <Image src="/klik-mark.png" alt="" width={22} height={22} className="rounded-[6px]" />
          <span className="text-sm text-muted">&copy; {new Date().getFullYear()} Klik</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted">
          <Link
            href="/terms"
            className="transition-colors hover:text-volt focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-volt"
          >
            Terms
          </Link>
          <Link
            href="/privacy"
            className="transition-colors hover:text-volt focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-volt"
          >
            Privacy
          </Link>
          <span>
            Made by{" "}
            <Link
              href="https://kreativvantage.com"
              className="text-paper transition-colors hover:text-volt focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-volt"
            >
              Kreativvantage
            </Link>
          </span>
        </div>
      </Container>
    </footer>
  );
}
