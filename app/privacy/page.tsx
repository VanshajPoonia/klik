import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "@/components/legal/legal-shell";
import { CURRENT_CONSENT } from "@/lib/consent";
import {
  BACKUP_EXPIRY_DAYS,
  GALLERY_ACCESS_DAYS,
  LEGAL_CONTACT_EMAIL,
  LEGAL_ENTITY,
  LEGAL_LAST_UPDATED,
  RATE_LIMIT_RETENTION_HOURS,
  SERVICE_NAME,
  SOFT_DELETE_DAYS,
} from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${SERVICE_NAME} handles photos, guest data and account data.`,
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      lastUpdated={LEGAL_LAST_UPDATED}
      summary={
        <>
          <p>
            Guests give us a first name, if they feel like it, and the photos they choose to
            upload. We never require a guest&rsquo;s email, we do not run facial recognition, and
            we strip location data out of every photo and video. Galleries expire on a
            schedule the organizer paid for, and deleted things are gone within{" "}
            {BACKUP_EXPIRY_DAYS} days including from our backup. We have never sold anyone&rsquo;s
            data and the business does not depend on doing so.
          </p>
        </>
      }
    >
      <p>
        This policy describes how {LEGAL_ENTITY} (&ldquo;we&rdquo;) handles personal information in{" "}
        {SERVICE_NAME}, a service for collecting photos and videos from guests at an event. It is
        written to describe what the software actually does rather than to reserve rights we do not
        exercise.
      </p>

      <h2>Two kinds of people use Klik</h2>
      <p>
        <strong>Organizers</strong> buy a plan, create an event and receive the gallery.{" "}
        <strong>Guests</strong> scan a QR code at that event and upload photos. We hold very
        different information about each, so the rest of this policy separates them.
      </p>

      <h2>What we collect from guests</h2>
      <p>When a guest joins a gallery, we store exactly this:</p>
      <ul>
        <li>
          <strong>A display name, if they enter one.</strong> It is optional and it is free text.
          Nobody checks it and a guest may use any name they like.
        </li>
        <li>
          <strong>The date and time they agreed to the consent notice</strong>, and a version
          identifier for the exact wording they were shown.
        </li>
        <li>
          <strong>The photos and videos they upload</strong>, along with the file type, size,
          dimensions, duration for video, and the time the photo was taken.
        </li>
      </ul>
      <p>
        We do <strong>not</strong> require a guest to give an email address, a phone number or an
        account to join a gallery or upload to it. A guest is identified to one gallery by a cookie
        on their own device.
      </p>
      <p>
        A guest <strong>may choose</strong> to sign in with their email address so they can find the
        galleries they joined again later, from any phone. If they do, we store that email address,
        and link the galleries they join while signed in, and the ones this device joined before,
        to it. Signing in is never needed to view, upload or download.
      </p>
      <p>
        If the organizer turns them on, a guest can also <strong>heart</strong> a photo and{" "}
        <strong>comment</strong> on it. A heart is recorded against the guest&apos;s cookie for that
        gallery, and other guests see only how many hearts a photo has, never whose they are. A
        comment needs a signed-in guest, and stores what they wrote and when; everyone who can see
        the photo sees the comment, with the guest&apos;s display name for that gallery beside it.
      </p>
      <p>
        If the organizer sets <strong>photo challenges</strong>, a photo taken for one is marked with
        it, and everyone in the gallery sees how many photos each challenge has. If the organizer also
        turns on the <strong>leaderboard</strong>, the five guests who have shared the most are listed
        in the gallery by their display name, with how many photos they shared. A guest who gave no
        name is never listed.
      </p>
      <p>
        An organizer can also set up a <strong>kiosk</strong>: a tablet at the venue that only takes
        photos for the gallery. A photo taken on it is stored like any other upload, against the kiosk
        rather than the person who took it, and the kiosk shows the consent notice below on its start
        screen to everyone who uses it. Because a kiosk is shared, a photo taken on one is removed by
        asking the organizer, who can take down anything in the gallery.
      </p>

      <h3>What the consent notice says</h3>
      <p>
        Before uploading, every guest is shown and must agree to this statement:{" "}
        <em>&ldquo;{CURRENT_CONSENT.statement}&rdquo;</em>
      </p>
      <p>
        That consent is deliberately narrow. It covers the one gallery the guest is uploading to. It
        does not permit us or the organizer to use those photos for marketing, on a public page, or
        anywhere else. When we change that wording we create a new version, and guests who agreed
        earlier stay recorded against the version they actually saw.
      </p>

      <h3>Location and camera data is removed</h3>
      <p>
        Phones embed a great deal in a photo file: GPS coordinates, the device serial, sometimes the
        owner&rsquo;s name. <strong>We re-encode every photo on upload, which discards all of it.</strong>{" "}
        Videos are not re-encoded, so instead <strong>we remove the location a phone writes into a
        video</strong> as soon as it arrives, and until that is done the video plays only for the
        person who filmed it. The one thing we deliberately keep is the time a photo or video was
        taken, because galleries are ordered by it. We never keep the location.
      </p>

      <h3>We do not analyse faces</h3>
      <p>
        {SERVICE_NAME} performs <strong>no facial recognition, no face grouping and no biometric
        analysis of any kind.</strong> We do not generate face templates, faceprints or any other
        biometric identifier, and we do not send photos to a third party that does. If that ever
        changes it will be an opt-in feature announced in advance, not a silent update to this page.
      </p>

      <h2>What we collect from organizers</h2>
      <ul>
        <li>Name, email address and a password, which is stored only as a bcrypt hash.</li>
        <li>A username, generated or chosen, used to invite co-hosts.</li>
        <li>Which plan the account is on and when it was activated.</li>
        <li>If signing in with Google: the name, email and profile image Google returns.</li>
      </ul>
      <p>
        <strong>We never see card details.</strong> Payment happens on a page hosted by Stripe. Card
        numbers go from the buyer to Stripe and never touch our servers or our database.
      </p>

      <h2>Technical information</h2>
      <ul>
        <li>
          <strong>IP addresses</strong> are used to rate-limit sign-in and signup attempts, which is
          what stops someone guessing passwords in bulk. They are stored only as part of a counter
          and are <strong>deleted after {RATE_LIMIT_RETENTION_HOURS} hours.</strong>
        </li>
        <li>
          <strong>Cookies</strong> are used for signing in, for remembering that a guest has joined
          a gallery, and for remembering that someone entered a gallery password. They are
          functional, set to expire, and readable only by the server. We run no advertising
          cookies, no analytics cookies and no third-party trackers.
        </li>
      </ul>

      <h2>How long we keep things</h2>
      <div className="legal-key">
        <p>
          <strong>Galleries</strong> stay available for {GALLERY_ACCESS_DAYS.event} days on the
          Event plan and {GALLERY_ACCESS_DAYS.premium} days on Premium and Venue, counted from when
          the event went live. Extending a plan extends the window; downgrading never shortens one
          that was already granted.
        </p>
        <p>
          <strong>Deleted photos</strong> are recoverable for {SOFT_DELETE_DAYS} days, then
          permanently removed.
        </p>
        <p>
          <strong>Our backup</strong> holds a second copy for a further day, so anything deleted is
          gone everywhere <strong>within {BACKUP_EXPIRY_DAYS} days.</strong>
        </p>
      </div>
      <p>
        The backup is the one place where deletion is not instant, and we would rather say so than
        imply otherwise. It exists because a bug in our own deletion code would otherwise destroy
        the only copy of somebody&rsquo;s wedding, and it is configured so that we cannot delete
        from it early even if we wanted to. It empties itself on a fixed rotation.
      </p>

      <h2>Who else touches the data</h2>
      <p>We use a small number of providers, each for one job:</p>
      <ul>
        <li>
          <strong>Cloudflare R2</strong> stores photos and videos, in the United States.
        </li>
        <li>
          <strong>Neon</strong> hosts the database.
        </li>
        <li>
          <strong>Vercel</strong> runs the application.
        </li>
        <li>
          <strong>Resend</strong> sends account email.
        </li>
        <li>
          <strong>Stripe</strong> processes payments and holds the card details we never see.
        </li>
      </ul>
      <p>
        That is the complete list. <strong>We do not sell personal information, we do not share it
        for advertising, and we do not use guest photos to train machine learning models.</strong>
      </p>

      <h2>Who can see a photo</h2>
      <p>
        Access is controlled by the organizer. A gallery can be public to anyone with the link,
        protected by a password, or private. An organizer can hide an individual photo, and can
        create a share link for one photo that can later be revoked, expired, or limited to a number
        of views. Every single request for a photo is checked against those rules at the moment it
        is made, so revoking access takes effect immediately rather than when a cache happens to
        expire.
      </p>
      <p>
        A guest can delete anything they uploaded. The organizer can also remove it, which is what
        the consent notice tells guests before they upload.
      </p>
      <p>
        A comment is seen by everyone who can see the photo it is on. Its author can delete it. The
        organizer can hide it, and so can we after reports; a hidden comment is kept, visible only to
        its author, the organizer and us, so it can be reviewed and shown again if the report was
        wrong.
      </p>

      <h2>Your choices</h2>
      <p>
        <strong>Guests:</strong> remove everything you added to a gallery, your name, hearts and
        comments included, from the bottom of that gallery at any time. If you signed in, you can do the same for any event
        from &ldquo;Your galleries&rdquo;, and deleting your account removes everything you shared
        everywhere. Otherwise write to us at{" "}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a> and tell us which event.
        Unless you signed in we hold no email address for you, so we will usually need the organizer
        to confirm which guest record is yours.
      </p>
      <p>
        <strong>Organizers:</strong> delete your account and everything in it yourself, from the
        Account page, or write to the same address. Write to us for an export. We action erasure immediately in the live system; the backup copy expires
        within {BACKUP_EXPIRY_DAYS} days as described above.
      </p>
      <p>
        Depending on where you live you may have rights to access, correct, delete or port your
        personal information, and to object to how it is used. We apply the choices above to
        everybody who asks, rather than checking which state you are in first.
      </p>

      <h2>Children</h2>
      <p>
        {SERVICE_NAME} is not directed to children under 13 and we do not knowingly collect personal
        information from them. We are aware that children are photographed at weddings and parties.
        A child appearing in a photograph an adult uploaded is not a child using the service, and we
        perform no analysis that would identify them. If you believe a child under 13 has created
        uploads themselves, contact us and we will remove them.
      </p>

      <h2>Security</h2>
      <p>
        Photos are stored in a private bucket and served only through short-lived signed links
        issued after an access check. Passwords are hashed with bcrypt and never stored in a form we
        could read. Sign-in and signup are rate-limited. We are a small team and we do not claim
        perfect security, but we would rather describe the specific measures we take than offer the
        usual reassurance that we take security seriously.
      </p>

      <h2>Changes</h2>
      <p>
        If we change this policy in a way that affects what we do with information we already hold,
        we will say so rather than quietly updating the date at the top.
      </p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>, or the phone number
        below. See also our <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalShell>
  );
}
