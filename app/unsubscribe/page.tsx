import type { Metadata } from "next";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Stop recap emails",
  robots: { index: false, follow: false },
};

const COPY = {
  en: {
    heading: "Stop recap emails",
    ask: "Klik sends a guest one email of a gallery's best photos, only when they ask for it. Press the button and this address will never get one again, from any gallery.",
    button: "Never email me again",
    done: "Done. This address will not get another email from Klik. We keep only a scrambled fingerprint of it, so we can tell it apart without being able to read it.",
    invalid: "This link is not complete. Use the link from the bottom of the email, or write to us and we will stop them by hand.",
  },
  es: {
    heading: "Dejar de recibir resúmenes",
    ask: "Klik envía a un invitado un solo correo con las mejores fotos de una galería, y solo si lo pide. Pulsa el botón y esta dirección no volverá a recibir ninguno, de ninguna galería.",
    button: "No volver a escribirme",
    done: "Listo. Esta dirección no recibirá otro correo de Klik. Solo guardamos una huella cifrada para reconocerla, sin poder leerla.",
    invalid: "Este enlace está incompleto. Usa el enlace del final del correo, o escríbenos y los detendremos a mano.",
  },
};

/**
 * GRW-1: where a recap's footer link lands. A button, not an action on load,
 * because mail scanners open links and nobody should be unsubscribed by one.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; s?: string; l?: string; done?: string; invalid?: string }>;
}) {
  const { e, s, l, done, invalid } = await searchParams;
  const locale = l === "es" ? "es" : "en";
  const copy = COPY[locale];
  const complete = typeof e === "string" && typeof s === "string" && e.length > 0 && s.length > 0;
  const query = new URLSearchParams({ e: e ?? "", s: s ?? "", ...(locale === "es" ? { l: "es" } : {}) });

  return (
    <main lang={locale} className="flex min-h-screen items-center justify-center bg-canvas px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl text-paper">{copy.heading}</h1>
        {done ? (
          <p className="mt-3 text-sm leading-relaxed text-muted" role="status">
            {copy.done}
          </p>
        ) : invalid || !complete ? (
          <p className="mt-3 text-sm leading-relaxed text-muted" role="alert">
            {copy.invalid}
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-muted">{copy.ask}</p>
            <form method="post" action={`/api/unsubscribe?${query.toString()}`} className="mt-6">
              <Button type="submit" className="w-full">
                {copy.button}
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
