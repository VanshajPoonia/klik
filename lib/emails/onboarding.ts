import type { EmailMessage } from "../email";
import { KIT_WAIT_HOURS, SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "../support";

/**
 * The email somebody gets the moment they create an account.
 *
 * It answers three questions in order, because they are asked in that order:
 * what is this, what do I do next, and who do I call. The link back to the plans
 * is the whole point of the middle one. Someone who signed up through the
 * pricing dialog is already on their way to Stripe, but someone who signed up
 * from the nav has an account and nothing to use it for, and this is the only
 * thing that puts a price in front of them again.
 *
 * A pure function returning the message, so the copy can be asserted in a test
 * without a mail provider. See lib/emails/onboarding.test.ts.
 */

/**
 * Escapes the one value here that comes from a person.
 *
 * A name is user input, it is interpolated into HTML, and this mail is rendered
 * by someone else's client. `<` and `&` are the two that break the document;
 * quotes matter because a name could land in an attribute in a later revision
 * of this template and finding out then is worse.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CANVAS = "#050505";
const PAPER = "#f3f1e9";
const VOLT = "#edee00";
const MUTED = "#8c8a80";
const LINE = "#232320";

/**
 * The recipient is the caller's business. This builds the message; `to` is the
 * one field it cannot know and the one field that must not be guessed.
 */
export function onboardingEmail({
  name,
  appUrl,
}: {
  name: string | null;
  /** Absolute, no trailing slash. Links in email cannot be relative. */
  appUrl: string;
}): Omit<EmailMessage, "to"> {
  const greeting = name?.trim() ? `Hi ${name.trim()}` : "Hi";
  const plansUrl = `${appUrl}/#pricing`;
  const dashboardUrl = `${appUrl}/dashboard`;

  const steps: Array<[string, string]> = [
    [
      "Pick your plan",
      `Klik Event covers one occasion, Premium adds albums, co-hosts and your own colors, and Venue is for running several events a month. Prices and the full comparison are on the plans page.`,
    ],
    [
      "Pay through Stripe",
      `Payment happens on Stripe's own secure page. Card details never reach Klik.`,
    ],
    [
      `Give us up to ${KIT_WAIT_HOURS} hours`,
      `Your kit is put together after the payment clears: your gallery, your QR code and the sign your guests scan. Your dashboard updates once it is ready.`,
    ],
    [
      "Put the QR where people are",
      `On the tables, by the door, on the bar. Guests scan it, add photos and videos, and never need an account or an app.`,
    ],
  ];

  const stepsHtml = steps
    .map(
      ([title, body], index) => `
          <tr>
            <td style="padding:0 0 18px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td width="34" valign="top" style="padding:0;">
                    <div style="width:26px;height:26px;border-radius:13px;background-color:${VOLT};color:${CANVAS};font:600 13px/26px Helvetica,Arial,sans-serif;text-align:center;">${index + 1}</div>
                  </td>
                  <td valign="top" style="padding:0;">
                    <p style="margin:2px 0 4px 0;font:600 15px/1.4 Helvetica,Arial,sans-serif;color:${PAPER};">${escapeHtml(title)}</p>
                    <p style="margin:0;font:400 14px/1.6 Helvetica,Arial,sans-serif;color:${MUTED};">${escapeHtml(body)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Welcome to Klik</title>
</head>
<body style="margin:0;padding:0;background-color:${CANVAS};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">One QR code. Every photo your guests take, in one gallery you keep.</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${CANVAS}" style="background-color:${CANVAS};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:560px;max-width:100%;">
          <tr>
            <td style="padding:0 0 28px 0;font:600 20px/1 Helvetica,Arial,sans-serif;color:${PAPER};letter-spacing:-0.4px;">klik</td>
          </tr>
          <tr>
            <td style="padding:0 0 10px 0;font:600 28px/1.2 Georgia,serif;color:${PAPER};">${escapeHtml(greeting)}, welcome to Klik.</td>
          </tr>
          <tr>
            <td style="padding:0 0 28px 0;font:400 15px/1.65 Helvetica,Arial,sans-serif;color:${MUTED};">
              Klik gives your event one QR code. Guests scan it, add their photos and videos, and
              everything lands in a single live gallery that you own, moderate and download. No app
              for them to install, no account for them to create, no photos lost in a group chat.
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 8px 0;border-top:1px solid ${LINE};"></td>
          </tr>
          <tr>
            <td style="padding:18px 0 14px 0;font:600 12px/1 Helvetica,Arial,sans-serif;color:${VOLT};letter-spacing:1.4px;text-transform:uppercase;">What happens next</td>
          </tr>
          <tr>
            <td style="padding:0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${stepsHtml}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0 28px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="${VOLT}" style="border-radius:999px;">
                    <a href="${plansUrl}" style="display:inline-block;padding:13px 26px;font:600 15px/1 Helvetica,Arial,sans-serif;color:${CANVAS};text-decoration:none;">See the plans</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 22px 0;border-top:1px solid ${LINE};"></td>
          </tr>
          <tr>
            <td style="padding:0 0 6px 0;font:600 15px/1.4 Helvetica,Arial,sans-serif;color:${PAPER};">Stuck, or in a hurry?</td>
          </tr>
          <tr>
            <td style="padding:0 0 28px 0;font:400 14px/1.65 Helvetica,Arial,sans-serif;color:${MUTED};">
              Call or text <a href="${SUPPORT_PHONE_HREF}" style="color:${VOLT};text-decoration:none;font-weight:600;">${SUPPORT_PHONE}</a>.
              A person answers. If your event is today, say so and we will put your kit together first.
            </td>
          </tr>
          <tr>
            <td style="padding:0;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:${MUTED};">
              You are getting this because an account was created with this address at
              <a href="${appUrl}" style="color:${MUTED};">${escapeHtml(appUrl.replace(/^https?:\/\//, ""))}</a>.
              Your dashboard is at <a href="${dashboardUrl}" style="color:${MUTED};">${escapeHtml(dashboardUrl.replace(/^https?:\/\//, ""))}</a>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `${greeting}, welcome to Klik.`,
    "",
    "Klik gives your event one QR code. Guests scan it, add their photos and videos,",
    "and everything lands in a single live gallery that you own, moderate and download.",
    "No app for them to install, no account for them to create.",
    "",
    "WHAT HAPPENS NEXT",
    "",
    ...steps.flatMap(([title, body], index) => [`${index + 1}. ${title}`, `   ${body}`, ""]),
    `See the plans: ${plansUrl}`,
    `Your dashboard: ${dashboardUrl}`,
    "",
    "STUCK, OR IN A HURRY?",
    `Call or text ${SUPPORT_PHONE}. A person answers. If your event is today, say so`,
    "and we will put your kit together first.",
  ].join("\n");

  return {
    subject: "Welcome to Klik, here is how to get your gallery live",
    html,
    text,
  };
}
