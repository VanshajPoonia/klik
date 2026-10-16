import type { ComponentType } from "react";
import { Container } from "./container";
import {
  DownloadsVignette,
  ExpirationVignette,
  ModerationVignette,
  PrivacyVignette,
  ProtectedDownloadsVignette,
  QrLinkVignette,
} from "./feature-vignettes";
import { FilmCell } from "./film-cell";
import { InView } from "./in-view";
import { TiltFrame } from "./tilt-frame";

const features: Array<{ n: string; title: string; body: string; Vignette: ComponentType }> = [
  {
    n: "33",
    title: "QR code & link",
    body: "Generate a QR code and shareable link the moment you create the event.",
    Vignette: QrLinkVignette,
  },
  {
    n: "34",
    title: "Moderation",
    body: "Approve every photo before it's public, or leave the gallery open. Your call.",
    Vignette: ModerationVignette,
  },
  {
    n: "35",
    title: "Privacy",
    body: "Make the gallery public, password-protected, or fully private.",
    Vignette: PrivacyVignette,
  },
  {
    n: "36",
    title: "Downloads",
    body: "Let guests save photos and videos, or keep everything gallery-only.",
    Vignette: DownloadsVignette,
  },
  {
    n: "37",
    title: "Expiration",
    body: "Set a closing date. The gallery locks itself when the event's over.",
    Vignette: ExpirationVignette,
  },
  {
    n: "38",
    title: "Protected downloads",
    body: "Download any stored photo or video from the organizer dashboard whenever you need it.",
    Vignette: ProtectedDownloadsVignette,
  },
];

export function OrganizerFeatures() {
  return (
    <section className="overflow-x-clip bg-canvas py-24 sm:py-32">
      <Container>
        <div className="max-w-xl">
          <h2 className="font-display text-4xl leading-tight tracking-tight text-paper sm:text-5xl">
            You&rsquo;re still the host.
          </h2>
          <p className="mt-5 text-lg text-muted">
            One dashboard for before, during, and after the event.
          </p>
        </div>
      </Container>

      {/* Two strips of three on a wide screen; one strip to swipe on a phone. */}
      <InView className="mt-14 sm:mt-16" threshold={0.1}>
        <ul className="stagger mx-auto flex max-w-6xl snap-x snap-mandatory scroll-px-6 overflow-x-auto px-6 pb-2 [scrollbar-width:none] md:grid md:grid-cols-3 md:gap-y-14 md:overflow-visible md:px-10 [&::-webkit-scrollbar]:hidden">
          {features.map(({ n, title, body, Vignette }) => (
            <li key={title} className="rise-in w-[82vw] max-w-[360px] shrink-0 snap-start md:w-auto md:max-w-none">
              <TiltFrame>
                <FilmCell n={n} label="Klik 400">
                  <div className="relative aspect-[3/2] overflow-hidden rounded-[2px]">
                    <Vignette />
                  </div>
                </FilmCell>
              </TiltFrame>
              <div className="pr-6 pt-6 md:pr-8">
                <h3 className="text-base font-medium text-paper">{title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </InView>
    </section>
  );
}
