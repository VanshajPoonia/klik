"use client";

import { InvitePeople, type InviteCopy, type InvitesPayload } from "@/components/share/invite-people";
import { shareState, type ManagedShare } from "@/lib/share-access";

/** MED-14, the dashboard's words for who a link is for. */
const HOST_INVITE_COPY: InviteCopy = {
  anyone: "Anyone with the link can open it.",
  onlyThem: (count) =>
    count === 0
      ? "Only people you invite can open it, and nobody is invited yet."
      : `Only the ${count === 1 ? "person" : `${count} people`} you invited can open it, signed in with that address.`,
  start: "Send it to particular people",
  manage: "Who it is for",
  label: "Their email addresses",
  hint: "Commas or new lines between them, up to 20 at a time. Each gets an email with the link. Once anyone is invited, nobody else holding the link can open it.",
  invite: "Invite",
  inviting: "Inviting",
  none: "Nobody is invited yet.",
  opened: "Opened",
  waiting: "Emailed, not opened yet",
  notEmailed: "Email not sent. They can still open it by signing in with this address and an email code.",
  remove: (email) => `Take ${email} off this link`,
  openToAnyone: "Let anyone with the link open it again",
  sent: (count) => `Invited ${count === 1 ? "1 person" : `${count} people`}.`,
  unsent: (emails) =>
    `The email to ${emails} did not go: Klik has sent its mail for today. Send them the link yourself; they open it by signing in with that address.`,
  already: (count) => `${count === 1 ? "1 was" : `${count} were`} invited already.`,
  invalid: (emails) => `These are not email addresses: ${emails}.`,
  full: (count) => `${count === 1 ? "1 was" : `${count} were`} left out: a link is for 50 people at most. Share a folder with everyone instead.`,
  failed: "That did not work. Try again.",
};

/** Under a live link, in the share sheet and on the Links tab. */
export function ShareInvites({
  eventId,
  share,
  startOpen,
  onChange,
}: {
  eventId: string;
  share: ManagedShare;
  startOpen?: boolean;
  onChange: (share: ManagedShare) => void;
}) {
  if (shareState(share) !== "live") return null;
  return (
    <InvitePeople<InvitesPayload & { share: ManagedShare }>
      endpoint={`/api/events/${eventId}/shares/${share.id}/invites`}
      copy={HOST_INVITE_COPY}
      inviteOnly={share.inviteOnly}
      inviteCount={share.inviteCount}
      startOpen={startOpen}
      onChange={(data) => onChange(data.share)}
    />
  );
}
