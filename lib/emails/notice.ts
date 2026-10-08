import type { EmailMessage } from "../email";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "../support";
import { CANVAS, LINE, MUTED, PAPER, VOLT, escapeHtml } from "./theme";

/**
 * One shell for the short operational notices: a storage warning, a retention
 * warning. Each says one thing and offers one button, so they share a layout
 * rather than each writing the same table out again. Text is passed in plain
 * and escaped here, so no caller can forget to.
 */
export function noticeEmail({
  subject,
  heading,
  paragraphs,
  cta,
  footer,
}: {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta: { label: string; url: string };
  footer: string;
}): Omit<EmailMessage, "to"> {
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:${CANVAS};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${CANVAS}" style="background-color:${CANVAS};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:560px;max-width:100%;">
        <tr><td style="padding:0 0 28px 0;font:600 20px/1 Helvetica,Arial,sans-serif;color:${PAPER};letter-spacing:-0.4px;">klik</td></tr>
        <tr><td style="padding:0 0 12px 0;font:600 26px/1.2 Georgia,serif;color:${PAPER};">${escapeHtml(heading)}</td></tr>
        ${paragraphs
          .map(
            (paragraph) =>
              `<tr><td style="padding:0 0 14px 0;font:400 15px/1.65 Helvetica,Arial,sans-serif;color:${MUTED};">${escapeHtml(paragraph)}</td></tr>`,
          )
          .join("\n        ")}
        <tr><td style="padding:12px 0 28px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td bgcolor="${VOLT}" style="border-radius:999px;"><a href="${cta.url}" style="display:inline-block;padding:13px 26px;font:600 15px/1 Helvetica,Arial,sans-serif;color:${CANVAS};text-decoration:none;">${escapeHtml(cta.label)}</a></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:10px 0 22px 0;border-top:1px solid ${LINE};"></td></tr>
        <tr><td style="padding:0 0 18px 0;font:400 14px/1.65 Helvetica,Arial,sans-serif;color:${MUTED};">
          Questions? Call or text <a href="${SUPPORT_PHONE_HREF}" style="color:${VOLT};text-decoration:none;font-weight:600;">${SUPPORT_PHONE}</a>. A person answers.
        </td></tr>
        <tr><td style="padding:0;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:${MUTED};">${escapeHtml(footer)}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = [heading, "", ...paragraphs.flatMap((paragraph) => [paragraph, ""]), `${cta.label}: ${cta.url}`, "", `Questions? Call or text ${SUPPORT_PHONE}.`, "", footer].join("\n");
  return { subject, html, text };
}
