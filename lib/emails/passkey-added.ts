import type { EmailMessage } from "../email";
import { noticeEmail } from "./notice";

/**
 * ACC-6: "a passkey was added to your account". Sent every time, because a
 * passkey outlives every session: if someone else added it, this is the only
 * way the owner finds out.
 */
export function passkeyAddedEmail({
  name,
  passkeyName,
  accountUrl,
  appUrl,
}: {
  name: string | null;
  passkeyName: string;
  accountUrl: string;
  appUrl: string;
}): Omit<EmailMessage, "to"> {
  const greeting = name?.trim() ? `Hi ${name.trim()},` : "Hi,";
  return noticeEmail({
    subject: "A passkey was added to your Klik account",
    heading: "New passkey added",
    paragraphs: [
      greeting,
      `A passkey called "${passkeyName}" can now sign in to your Klik account with that device's Face ID, fingerprint or PIN.`,
      "If that was you, there is nothing to do. If it was not, remove it from your account now. Removing it stops it working straight away.",
    ],
    cta: { label: "Check your passkeys", url: accountUrl },
    footer: `Sent by ${appUrl.replace(/^https?:\/\//, "")} because the sign-in methods on your account changed.`,
  });
}
