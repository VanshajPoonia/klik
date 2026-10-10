"use client";

import { useState } from "react";
import { ExternalLink, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, inputClass } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";

const BIO_LIMIT = 280;

/**
 * GRW-4: the account's public page at /u/<username>. Off by default. It shows
 * the words here and the events listed from each event's settings, by name
 * and date; never a photo.
 */
export function ProfileCard({
  initial,
  username,
}: {
  initial: { isPublic: boolean; bio: string | null; website: string | null };
  username: string | null;
}) {
  const [isPublic, setIsPublic] = useState(initial.isPublic);
  const [bio, setBio] = useState(initial.bio ?? "");
  const [website, setWebsite] = useState(initial.website ?? "");
  const [savedPublic, setSavedPublic] = useState(initial.isPublic);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    const result = await apiRequest<{ profile: { isPublic: boolean; website: string | null } }>(
      "/api/me/profile",
      { method: "PATCH", body: { isPublic, bio: bio || null, website: website || null } },
      "Could not save your profile",
    );
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    setSavedPublic(result.data.profile.isPublic);
    setWebsite(result.data.profile.website ?? "");
    setMessage({
      tone: "ok",
      text: result.data.profile.isPublic
        ? "Saved. List events on it from each event's Settings."
        : "Saved. Your profile is not public.",
    });
  }

  return (
    <section id="profile" className="space-y-4" aria-labelledby="profile-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-md">
          <h2 id="profile-heading" className="flex items-center gap-2 text-sm font-medium text-paper">
            <UserRound className="h-4 w-4 text-volt" aria-hidden="true" />
            Public profile
          </h2>
          <p className="mt-1 text-xs text-muted">
            A page at /u/{username ?? "your-username"} with your name, these words, and the galleries you choose to list.
            Guests&apos; photos are never shown on it.
          </p>
        </div>
        {savedPublic && username && (
          <a
            href={`/u/${username}`}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-volt hover:underline"
          >
            View it
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </div>

      <Checkbox checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} disabled={!username}>
        {username ? "Make my profile public" : "Choose a username above to have a profile"}
      </Checkbox>

      <Field label="About you" htmlFor="profile-bio" hint={`${bio.length} of ${BIO_LIMIT}`}>
        <textarea
          id="profile-bio"
          className={`${inputClass} min-h-24`}
          value={bio}
          onChange={(event) => setBio(event.target.value.slice(0, BIO_LIMIT))}
          placeholder="Wedding and event photographer in Austin. Booking 2027."
        />
      </Field>
      <Field label="Website" htmlFor="profile-website" hint="Optional. An https:// address.">
        <input
          id="profile-website"
          className={inputClass}
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://yourstudio.com"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </Button>
        {message && (
          <p className={`text-sm ${message.tone === "ok" ? "text-muted" : "text-red-400"}`} role={message.tone === "ok" ? "status" : "alert"}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}
