import type { EmailMessage } from "../email";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "../support";
import { CANVAS, LINE, MUTED, PAPER, VOLT, escapeHtml, renderStepsHtml, renderStepsText } from "./theme";

/**
 * The email somebody gets when a superadmin opens their access.
 *
 * This is the other half of `onboarding.ts`, and the difference between the two
 * is the whole reason it is a separate template rather than a flag. The welcome
 * mail talks to somebody who has not paid: its steps are pick a plan, pay, wait.
 * This one talks to somebody who has, and whose dashboard is already unlocked,
 * so repeating any of that would read as being asked to pay twice.
 *
 * **The event does not exist yet when this is sent.** Activation grants the
 * account its plan; the gallery, the QR code and the printable sign are all
 * generated the moment the organizer creates the event, which is their action
 * and not ours. The copy has to be exact about that, because "your QR code is
 * ready" sends somebody hunting a dashboard for something that is one click away
 * but not yet made, and they call support instead of clicking.
 *
 * A pure function returning the message, so the copy can be asserted without a
 * mail provider. See lib/emails/activation.test.ts.
 */
export function activationEmail({
  name,
  planName,
  username,
  appUrl,
}: {
  name: string | null;
  /** The plan just granted, named as the customer saw it on the pricing page. */
  planName: string;
  /**
   * Set only on accounts a superadmin created at /admin/new, who were handed a
   * generated username and will not remember it. Null for anyone who signed
   * themselves up, who knows their own email address.
   */
  username: string | null;
  /** Absolute, no trailing slash. Links in email cannot be relative. */
  appUrl: string;
}): Omit<EmailMessage, "to"> {
  const greeting = name?.trim() ? `Hi ${name.trim()}` : "Hi";
  const dashboardUrl = `${appUrl}/dashboard`;
  const loginUrl = `${appUrl}/login`;

  const steps: Array<[string, string]> = [
    [
      "Open your dashboard",
      username
        ? `Sign in with the username ${username} at ${loginUrl.replace(/^https?:\/\//, "")}. Everything below happens there.`
        : `Sign in with this email address at ${loginUrl.replace(/^https?:\/\//, "")}. Everything below happens there.`,
    ],
    [
      "Create your event",
      "Name it, set the date, and pick your colors. It takes about a minute, and you can change any of it later.",
    ],
    [
      "Collect your QR code and printable sign",
      "Both are generated the moment your event exists. Download the sign as it is, or send the file to a print shop. Three templates, and the QR in the middle is yours permanently.",
    ],
    [
      "Put the QR where people are",
      "On the tables, by the door, on the bar. Guests scan it and start adding photos and videos straight away. No app to install, no account to create, nothing to explain.",
    ],
    [
      "Keep all of it",
      "Photos land in your gallery as they are taken. Decide what shows, and download everything as a single zip whenever you want it.",
    ],
  ];

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Klik access is open</title>
</head>
<body style="margin:0;padding:0;background-color:${CANVAS};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(planName)} is active on your account. Your dashboard is open from right now.</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${CANVAS}" style="background-color:${CANVAS};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:560px;max-width:100%;">
          <tr>
            <td style="padding:0 0 28px 0;font:600 20px/1 Helvetica,Arial,sans-serif;color:${PAPER};letter-spacing:-0.4px;">klik</td>
          </tr>
          <tr>
            <td style="padding:0 0 10px 0;font:600 28px/1.2 Georgia,serif;color:${PAPER};">${escapeHtml(greeting)}, you are all set.</td>
          </tr>
          <tr>
            <td style="padding:0 0 10px 0;font:400 15px/1.65 Helvetica,Arial,sans-serif;color:${MUTED};">
              Your payment is confirmed and <strong style="color:${PAPER};font-weight:600;">${escapeHtml(planName)}</strong> is
              active on your account. Your dashboard is open from right now.
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 26px 0;font:400 15px/1.65 Helvetica,Arial,sans-serif;color:${MUTED};">
              Create your event and your gallery, your QR code and your printable sign are all
              generated on the spot. Nothing else to wait for.
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 28px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="${VOLT}" style="border-radius:999px;">
                    <a href="${dashboardUrl}" style="display:inline-block;padding:13px 26px;font:600 15px/1 Helvetica,Arial,sans-serif;color:${CANVAS};text-decoration:none;">Open your dashboard</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 8px 0;border-top:1px solid ${LINE};"></td>
          </tr>
          <tr>
            <td style="padding:18px 0 14px 0;font:600 12px/1 Helvetica,Arial,sans-serif;color:${VOLT};letter-spacing:1.4px;text-transform:uppercase;">Getting your gallery live</td>
          </tr>
          <tr>
            <td style="padding:0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${renderStepsHtml(steps)}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0 22px 0;border-top:1px solid ${LINE};"></td>
          </tr>
          <tr>
            <td style="padding:0 0 6px 0;font:600 15px/1.4 Helvetica,Arial,sans-serif;color:${PAPER};">Event today, or something not working?</td>
          </tr>
          <tr>
            <td style="padding:0 0 28px 0;font:400 14px/1.65 Helvetica,Arial,sans-serif;color:${MUTED};">
              Call or text <a href="${SUPPORT_PHONE_HREF}" style="color:${VOLT};text-decoration:none;font-weight:600;">${SUPPORT_PHONE}</a>.
              A person answers. If your event is today, say so first and we will get you live before anything else.
            </td>
          </tr>
          <tr>
            <td style="padding:0;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:${MUTED};">
              You are getting this because ${escapeHtml(planName)} was activated for this address at
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
    `${greeting}, you are all set.`,
    "",
    `Your payment is confirmed and ${planName} is active on your account.`,
    "Your dashboard is open from right now.",
    "",
    "Create your event and your gallery, your QR code and your printable sign are",
    "all generated on the spot. Nothing else to wait for.",
    "",
    `Open your dashboard: ${dashboardUrl}`,
    "",
    "GETTING YOUR GALLERY LIVE",
    "",
    ...renderStepsText(steps),
    "EVENT TODAY, OR SOMETHING NOT WORKING?",
    `Call or text ${SUPPORT_PHONE}. A person answers. If your event is today, say so`,
    "first and we will get you live before anything else.",
  ].join("\n");

  return {
    subject: `Your Klik access is open, here is how to get your QR code`,
    html,
    text,
  };
}
