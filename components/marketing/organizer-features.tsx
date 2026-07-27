import { QrCode, ShieldCheck, Lock, Share2, CalendarClock, Download } from "lucide-react";
import { Container } from "./container";

const features = [
  {
    icon: QrCode,
    title: "QR code & link",
    body: "Generate a QR code and shareable link the moment you create the event.",
  },
  {
    icon: ShieldCheck,
    title: "Moderation",
    body: "Approve every photo before it's public, or leave the gallery open - your call.",
  },
  {
    icon: Lock,
    title: "Privacy",
    body: "Make the gallery public, password-protected, or fully private.",
  },
  {
    icon: Share2,
    title: "Downloads",
    body: "Let guests save photos and videos, or keep everything gallery-only.",
  },
  {
    icon: CalendarClock,
    title: "Expiration",
    body: "Set a closing date. The gallery locks itself when the event's over.",
  },
  {
    icon: Download,
    title: "Original files",
    body: "Download any photo or video from the organizer dashboard whenever you need it.",
  },
];

export function OrganizerFeatures() {
  return (
    <section className="bg-canvas py-24 sm:py-32">
      <Container>
        <div className="max-w-xl">
          <h2 className="font-display text-4xl leading-tight tracking-tight text-paper sm:text-5xl">
            You&rsquo;re still the host.
          </h2>
          <p className="mt-5 text-lg text-muted">
            One dashboard for before, during, and after the event.
          </p>
        </div>
        <div className="mt-16 grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <div key={title} className="border-t border-canvas-line pt-6">
              <Icon className="h-5 w-5 text-volt" strokeWidth={1.75} />
              <h3 className="mt-4 text-base font-medium text-paper">{title}</h3>
              <p className="mt-2 leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
