import type { EmailMessage } from "../email";
import type { Locale } from "../i18n/locale";
import { CANVAS, LINE, MUTED, PAPER, VOLT, escapeHtml } from "./theme";

/**
 * GRW-1: the one email a guest asked for. The photos first, the way back to
 * the gallery second, and "host your own" last and quiet, below the photos as
 * the roadmap asks. The footer says why it came, that it is the only one, and
 * how to never get another, with the postal address CAN-SPAM requires.
 */

const COPY = {
  en: {
    subject: (event: string) => `Your photos from ${event}`,
    heading: (event: string) => `The best of ${event}`,
    intro: (photos: number, guests: number) =>
      guests > 1
        ? `Here are the highlights, picked from ${photos} photos shared by ${guests} people.`
        : `Here are the highlights, picked from ${photos} photos.`,
    cta: "See every photo",
    host: "Hosting something of your own? Klik puts every guest's photos in one gallery from one QR code, with nothing to install.",
    hostLink: "See how it works",
    why: (event: string) =>
      `You are getting this because you asked for the photos when you joined the ${event} gallery. It is the only email you will get about it, and Klik has now deleted your address.`,
    stop: "Never email me a recap again",
    privacy: "Privacy",
  },
  es: {
    subject: (event: string) => `Tus fotos de ${event}`,
    heading: (event: string) => `Lo mejor de ${event}`,
    intro: (photos: number, guests: number) =>
      guests > 1
        ? `Aquí tienes lo mejor, elegido entre ${photos} fotos que compartieron ${guests} personas.`
        : `Aquí tienes lo mejor, elegido entre ${photos} fotos.`,
    cta: "Ver todas las fotos",
    host: "¿Organizas algo tú? Klik reúne las fotos de todos tus invitados en una galería con un solo código QR, sin instalar nada.",
    hostLink: "Mira cómo funciona",
    why: (event: string) =>
      `Te llega porque pediste las fotos al entrar en la galería de ${event}. Es el único correo que recibirás sobre ella, y Klik ya borró tu dirección.`,
    stop: "No volver a enviarme un resumen",
    privacy: "Privacidad",
  },
} satisfies Record<Locale, unknown>;

export type RecapPhoto = { src: string; href: string };

export function recapEmail({
  locale,
  eventName,
  eventDate,
  photos,
  photoCount,
  contributorCount,
  galleryUrl,
  hostUrl,
  unsubscribeUrl,
  privacyUrl,
  postalAddress,
}: {
  locale: Locale;
  eventName: string;
  eventDate: Date | null;
  photos: RecapPhoto[];
  photoCount: number;
  contributorCount: number;
  galleryUrl: string;
  hostUrl: string;
  unsubscribeUrl: string;
  privacyUrl: string;
  postalAddress: string;
}): Omit<EmailMessage, "to"> {
  const copy = COPY[locale] ?? COPY.en;
  const subject = copy.subject(eventName);
  const heading = copy.heading(eventName);
  // A calendar day, stored as UTC midnight, so read in UTC.
  const date = eventDate
    ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(eventDate)
    : null;
  const intro = copy.intro(photoCount, contributorCount);
  const link = (url: string) => escapeHtml(url);

  // Three across, in a table, because that is what every mail client agrees on.
  const rows: RecapPhoto[][] = [];
  for (let index = 0; index < photos.length; index += 3) rows.push(photos.slice(index, index + 3));
  const grid = rows
    .map(
      (row) => `<tr>${row
        .map(
          (photo) =>
            `<td width="33%" style="padding:3px;"><a href="${link(photo.href)}"><img src="${link(photo.src)}" width="180" alt="" style="display:block;width:100%;max-width:180px;height:auto;border:0;border-radius:10px;background-color:${LINE};"></a></td>`,
        )
        .join("")}${'<td width="33%" style="padding:3px;"></td>'.repeat(3 - row.length)}</tr>`,
    )
    .join("\n            ");

  const html = `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:${CANVAS};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${CANVAS}" style="background-color:${CANVAS};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:560px;max-width:100%;">
        <tr><td style="padding:0 0 28px 0;font:600 20px/1 Helvetica,Arial,sans-serif;color:${PAPER};letter-spacing:-0.4px;">klik</td></tr>
        <tr><td style="padding:0 0 8px 0;font:600 26px/1.2 Georgia,serif;color:${PAPER};">${escapeHtml(heading)}</td></tr>
        ${date ? `<tr><td style="padding:0 0 14px 0;font:400 13px/1.4 Helvetica,Arial,sans-serif;color:${MUTED};">${escapeHtml(date)}</td></tr>` : ""}
        <tr><td style="padding:0 0 18px 0;font:400 15px/1.65 Helvetica,Arial,sans-serif;color:${MUTED};">${escapeHtml(intro)}</td></tr>
        <tr><td style="padding:0 0 18px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            ${grid}
          </table>
        </td></tr>
        <tr><td style="padding:6px 0 30px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td bgcolor="${VOLT}" style="border-radius:999px;"><a href="${link(galleryUrl)}" style="display:inline-block;padding:13px 26px;font:600 15px/1 Helvetica,Arial,sans-serif;color:${CANVAS};text-decoration:none;">${escapeHtml(copy.cta)}</a></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:18px 0 22px 0;border-top:1px solid ${LINE};font:400 14px/1.65 Helvetica,Arial,sans-serif;color:${MUTED};">
          ${escapeHtml(copy.host)} <a href="${link(hostUrl)}" style="color:${PAPER};text-decoration:underline;">${escapeHtml(copy.hostLink)}</a>
        </td></tr>
        <tr><td style="padding:0 0 10px 0;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:${MUTED};">${escapeHtml(copy.why(eventName))}</td></tr>
        <tr><td style="padding:0 0 10px 0;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:${MUTED};">
          <a href="${link(unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(copy.stop)}</a>
          &nbsp;·&nbsp; <a href="${link(privacyUrl)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(copy.privacy)}</a>
        </td></tr>
        <tr><td style="padding:0;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:${MUTED};">Klik, ${escapeHtml(postalAddress)}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    heading,
    ...(date ? [date] : []),
    "",
    intro,
    "",
    `${copy.cta}: ${galleryUrl}`,
    "",
    `${copy.host} ${copy.hostLink}: ${hostUrl}`,
    "",
    copy.why(eventName),
    `${copy.stop}: ${unsubscribeUrl}`,
    `${copy.privacy}: ${privacyUrl}`,
    "",
    `Klik, ${postalAddress}`,
  ].join("\n");

  return { subject, html, text };
}
