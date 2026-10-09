import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "@/components/legal/legal-shell";
import { PLANS } from "@/lib/plans";
import { KIT_WAIT_HOURS } from "@/lib/support";
import {
  BACKUP_EXPIRY_DAYS,
  GALLERY_ACCESS_DAYS,
  LEGAL_CONTACT_EMAIL,
  LEGAL_ENTITY,
  LEGAL_LAST_UPDATED,
  SERVICE_NAME,
  SOFT_DELETE_DAYS,
} from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `The agreement between you and ${LEGAL_ENTITY} for using ${SERVICE_NAME}.`,
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      lastUpdated={LEGAL_LAST_UPDATED}
      summary={
        <p>
          Buy a plan, we switch your account on within {KIT_WAIT_HOURS} hours, and you get a QR code
          your guests scan to upload photos. Your gallery stays live for the period your plan says.
          Your photos stay yours. Don&rsquo;t upload things you have no right to, and don&rsquo;t
          upload anything illegal. If we get something badly wrong, refunds are handled by a human
          rather than by a clause.
        </p>
      }
    >
      <p>
        These terms are the agreement between you and {LEGAL_ENTITY} (&ldquo;we&rdquo;) for the use
        of {SERVICE_NAME}. By creating an account or uploading to a gallery, you agree to them.
      </p>

      <h2>What the service is</h2>
      <p>
        {SERVICE_NAME} gives an event organizer a QR code and a printable sign. Guests scan it,
        agree to a short notice, and upload photos and videos to a shared gallery the organizer
        controls. The organizer can download everything as a zip.
      </p>

      <h2>Accounts and activation</h2>
      <p>
        You need an account to create events. You are responsible for what happens under it,
        including keeping your password to yourself. One person must be accountable for each
        account, even where co-hosts have access.
      </p>
      <p>
        <strong>Activation is done by a person, not automatically.</strong> After you pay we switch
        your account on by hand, which we aim to do well within {KIT_WAIT_HOURS} hours and usually
        do in minutes. We email you the moment it is live. If that email has not arrived and the
        time has passed, call us rather than paying again.
      </p>

      <h2>Plans, payment and what each one includes</h2>
      <ul>
        <li>
          <strong>{PLANS.event.name}, {PLANS.event.price} {PLANS.event.priceSuffix}.</strong>{" "}
          Gallery available for {GALLERY_ACCESS_DAYS.event} days.
        </li>
        <li>
          <strong>{PLANS.premium.name}, {PLANS.premium.price} {PLANS.premium.priceSuffix}.</strong>{" "}
          Gallery available for {GALLERY_ACCESS_DAYS.premium} days.
        </li>
        <li>
          <strong>{PLANS.venue.name}, {PLANS.venue.price} {PLANS.venue.priceSuffix}.</strong>{" "}
          Galleries available for {GALLERY_ACCESS_DAYS.venue} days.
        </li>
      </ul>
      <p>
        Payment is taken by Stripe. We never see your card details. Prices are in US dollars and
        exclude any tax that may apply where you are.
      </p>
      <p>
        <strong>Upgrading extends how long a gallery survives. Downgrading never shortens a window
        you were already given.</strong> That is enforced in the software, not just promised here:
        a plan change can only move a gallery&rsquo;s expiry further out.
      </p>

      <h2>Refunds</h2>
      <p>
        If we fail to activate your account before your event, or the service does not work and we
        cannot fix it, tell us and we will refund you. We would rather settle a disputed charge
        than argue about it, and there is a phone number at the bottom of this page answered by a
        person.
      </p>
      <p>
        We will not generally refund an event that ran successfully because fewer guests uploaded
        than you hoped.
      </p>

      <h2>Your content stays yours</h2>
      <p>
        <strong>You own what you upload, and what you write in a comment. We claim no ownership of
        it.</strong> You grant us only the permission we need to operate the service: to store your
        photos and comments, to process them so they display properly, and to show them to the
        people who have access to the gallery. That permission
        ends when you delete the content or close your account.
      </p>
      <p>
        <strong>We will not use your photographs to advertise {SERVICE_NAME}</strong> without asking
        you first, and we do not use them to train machine learning models.
      </p>

      <h2>What you must not upload or write</h2>
      <p>Do not upload, or write in a comment, anything that:</p>
      <ul>
        <li>You do not have the right to share. A photographer you hired usually owns their photos.</li>
        <li>Shows a person in a way they have not agreed to, or that would humiliate or endanger them.</li>
        <li>Is sexual content involving minors, which we report rather than merely remove.</li>
        <li>Is unlawful, or harasses or threatens somebody.</li>
        <li>Contains malware, or is an attempt to use the gallery as general file storage.</li>
      </ul>
      <p>
        Organizers are responsible for their guests. If you print a QR code and put it on a table,
        you are the person deciding who can upload. If you turn on comments, you can hide any of
        them, and we may hide or remove a comment that breaks these rules.
      </p>

      <h2>Copyright and the DMCA</h2>
      <p>
        We respond to valid notices of claimed copyright infringement under the Digital Millennium
        Copyright Act and will remove material that is the subject of one. We terminate the accounts
        of repeat infringers.
      </p>
      <p>
        To send a notice, write to{" "}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a> with the work concerned,
        where it appears on {SERVICE_NAME}, your contact details, and a statement that you believe
        in good faith that the use is not authorized. If you believe your material was removed in
        error you may send a counter-notice to the same address.
      </p>

      <h2>Deletion and how long things last</h2>
      <div className="legal-key">
        <p>
          A gallery stays available for the period your plan sets, counted from when the event goes
          live.
        </p>
        <p>
          Deleted items are recoverable for {SOFT_DELETE_DAYS} days, then permanently removed, and
          gone from our backup within {BACKUP_EXPIRY_DAYS} days.
        </p>
      </div>
      <p>
        <strong>Download your photos before your gallery expires.</strong> We will not hold them
        past the window your plan covers, and once the retention period has run we cannot get them
        back for you. The dashboard shows the expiry date and offers a full download at any time.
      </p>

      <h2>Suspension</h2>
      <p>
        We may suspend or remove an account or a gallery that breaks these terms, that is being used
        to harm somebody, or where we are legally required to. Where we reasonably can, we will tell
        you first and give you a chance to download your content.
      </p>

      <h2>Availability</h2>
      <p>
        We do not promise the service will be uninterrupted. We run on infrastructure that
        occasionally fails and we are a small team. What we do commit to is that your photos are
        kept in two separate places, and that we will tell you honestly if something has gone wrong
        rather than waiting for you to notice.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, our total liability for any claim relating to the service is
        limited to what you paid us in the twelve months before the claim. We are not liable for
        indirect or consequential losses.
      </p>
      <p>
        Nothing here limits liability that cannot lawfully be limited, including for fraud or for
        death or personal injury caused by negligence. Some states do not allow certain limitations,
        in which case the limitation applies only as far as that state permits.
      </p>

      <h2>Governing law</h2>
      <p>
        {SERVICE_NAME} is operated from the United States and offered to users in the United States.
        These terms are governed by the laws of the State of Missouri, without regard to its
        conflict of law rules.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. If a change materially affects your rights we will tell account
        holders by email rather than relying on you to re-read this page.
      </p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>, or the phone number
        below. See also our <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </LegalShell>
  );
}
