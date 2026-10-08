import type { EmailMessage } from "../email";
import { formatFileSize } from "../plans";
import { CANVAS, LINE, MUTED, PAPER, VOLT, escapeHtml } from "./theme";

/**
 * "Your download is ready." Links to the event's dashboard rather than to the
 * files, because a link in an email is forwarded and a file link would be a
 * bearer token for the whole gallery. The dashboard checks who is asking every
 * time, and hands out a short-lived link from there.
 */
export function exportReadyEmail({
  name,
  eventName,
  partCount,
  totalBytes,
  expiresAt,
  eventUrl,
  appUrl,
}: {
  name: string | null;
  eventName: string;
  partCount: number;
  totalBytes: number;
  expiresAt: Date | null;
  eventUrl: string;
  appUrl: string;
}): Omit<EmailMessage, "to"> {
  const greeting = name?.trim() ? `Hi ${name.trim()}` : "Hi";
  const files = partCount === 1 ? "one ZIP file" : `${partCount} ZIP files`;
  const until = expiresAt
    ? expiresAt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : "a week from now";
  const summary = `${files}, ${formatFileSize(totalBytes)} in all`;

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your download is ready</title></head>
<body style="margin:0;padding:0;background-color:${CANVAS};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${CANVAS}" style="background-color:${CANVAS};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:560px;max-width:100%;">
        <tr><td style="padding:0 0 28px 0;font:600 20px/1 Helvetica,Arial,sans-serif;color:${PAPER};letter-spacing:-0.4px;">klik</td></tr>
        <tr><td style="padding:0 0 10px 0;font:600 28px/1.2 Georgia,serif;color:${PAPER};">${escapeHtml(greeting)}, your download is ready.</td></tr>
        <tr><td style="padding:0 0 26px 0;font:400 15px/1.65 Helvetica,Arial,sans-serif;color:${MUTED};">
          Everything from <strong style="color:${PAPER};font-weight:600;">${escapeHtml(eventName)}</strong> is packed into
          ${escapeHtml(summary)}. It stays available until ${escapeHtml(until)}, and you can make a fresh one any time after that.
        </td></tr>
        <tr><td style="padding:0 0 28px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td bgcolor="${VOLT}" style="border-radius:999px;"><a href="${eventUrl}" style="display:inline-block;padding:13px 26px;font:600 15px/1 Helvetica,Arial,sans-serif;color:${CANVAS};text-decoration:none;">Download it</a></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:10px 0 22px 0;border-top:1px solid ${LINE};"></td></tr>
        <tr><td style="padding:0;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:${MUTED};">
          You asked for this download at <a href="${appUrl}" style="color:${MUTED};">${escapeHtml(appUrl.replace(/^https?:\/\//, ""))}</a>.
          The link opens your dashboard, so you will be asked to sign in if you are not already.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `${greeting}, your download is ready.`,
    "",
    `Everything from ${eventName} is packed into ${summary}.`,
    `It stays available until ${until}, and you can make a fresh one any time after that.`,
    "",
    `Download it: ${eventUrl}`,
    "",
    "The link opens your dashboard, so you will be asked to sign in if you are not already.",
  ].join("\n");

  return { subject: `Your ${eventName} download is ready`, html, text };
}
