import type { EmailMessage } from "../email";
import { noticeEmail } from "./notice";

/** GRW-5: "someone you invited is now using Klik, and you have credit." */
export function referralCreditEmail({
  name,
  who,
  amount,
  accountUrl,
  appUrl,
}: {
  name: string | null;
  who: string;
  amount: string;
  accountUrl: string;
  appUrl: string;
}): Omit<EmailMessage, "to"> {
  return noticeEmail({
    subject: `You earned ${amount} of Klik credit`,
    heading: `${amount} of credit is yours`,
    paragraphs: [
      name?.trim() ? `Hi ${name.trim()},` : "Hi,",
      `${who} signed up through your link and their first event is live, so you each get ${amount} off a future purchase.`,
      "We take it off your next payment for you. Your account page shows your credit and your link to share again.",
    ],
    cta: { label: "See your credit", url: accountUrl },
    footer: `Sent by ${appUrl.replace(/^https?:\/\//, "")} because someone used your referral link.`,
  });
}
