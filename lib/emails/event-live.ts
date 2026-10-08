import type { EmailMessage } from "../email";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "../support";
import { CANVAS, LINE, MUTED, PAPER, VOLT, escapeHtml } from "./theme";

/**
 * "Your event is live", for a grant that licenses an event on an account that
 * was already active (ACT-3).
 *
 * The first grant on an account sends the access email instead, which says the
 * same thing and more. This one is for the organizer's second event, or a
 * draft activated after they asked: the case where nothing else would tell
 * them, and a host who printed nothing because they did not know is a host
 * whose guests find no QR code.
 */
export function eventLiveEmail({
  name,
  eventName,
  planName,
  eventUrl,
  appUrl,
}: {
  name: string | null;
  eventName: string;
  planName: string;
  /** The organizer's own page for the event, where the QR and sign are. */
  eventUrl: string;
  appUrl: string;
}): Omit<EmailMessage, "to"> {
  const greeting = name?.trim() ? `Hi ${name.trim()}` : "Hi";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(eventName)} is live</title>
</head>
<body style="margin:0;padding:0;background-color:${CANVAS};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Guests can join now. Your QR code and printable sign are ready.</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${CANVAS}" style="background-color:${CANVAS};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:560px;max-width:100%;">
          <tr>
            <td style="padding:0 0 28px 0;font:600 20px/1 Helvetica,Arial,sans-serif;color:${PAPER};letter-spacing:-0.4px;">klik</td>
          </tr>
          <tr>
            <td style="padding:0 0 10px 0;font:600 28px/1.2 Georgia,serif;color:${PAPER};">${escapeHtml(greeting)}, ${escapeHtml(eventName)} is live.</td>
          </tr>
          <tr>
            <td style="padding:0 0 26px 0;font:400 15px/1.65 Helvetica,Arial,sans-serif;color:${MUTED};">
              It is running on <strong style="color:${PAPER};font-weight:600;">${escapeHtml(planName)}</strong>. Guests can
              join and upload from now, and your QR code and printable sign are ready to download.
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 28px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="${VOLT}" style="border-radius:999px;">
                    <a href="${eventUrl}" style="display:inline-block;padding:13px 26px;font:600 15px/1 Helvetica,Arial,sans-serif;color:${CANVAS};text-decoration:none;">Get your QR code</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0 22px 0;border-top:1px solid ${LINE};"></td>
          </tr>
          <tr>
            <td style="padding:0 0 28px 0;font:400 14px/1.65 Helvetica,Arial,sans-serif;color:${MUTED};">
              Event today, or something not working? Call or text
              <a href="${SUPPORT_PHONE_HREF}" style="color:${VOLT};text-decoration:none;font-weight:600;">${SUPPORT_PHONE}</a>.
              A person answers.
            </td>
          </tr>
          <tr>
            <td style="padding:0;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:${MUTED};">
              Sent because an event on your Klik account at
              <a href="${appUrl}" style="color:${MUTED};">${escapeHtml(appUrl.replace(/^https?:\/\//, ""))}</a> went live.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `${greeting}, ${eventName} is live.`,
    "",
    `It is running on ${planName}. Guests can join and upload from now, and your QR`,
    "code and printable sign are ready to download.",
    "",
    `Get your QR code: ${eventUrl}`,
    "",
    `Event today, or something not working? Call or text ${SUPPORT_PHONE}. A person answers.`,
  ].join("\n");

  return { subject: `${eventName} is live on Klik`, html, text };
}
