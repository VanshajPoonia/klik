"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button, buttonClassName } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, inputClass } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { VisibilityField, type Visibility } from "@/components/dashboard/visibility-field";
import { endOfDayIso } from "@/lib/dates";
import { PLANS, type PlanKey } from "@/lib/plans";
import { ColorwayPicker, OccasionPicker, TemplatePicker } from "@/components/dashboard/template-picker";
import { LookFields, lookFieldsPayload } from "@/components/dashboard/look-fields";
import { templateByKey, templatesFor, type OccasionKey, type TemplateFields } from "@/lib/gallery-templates";

interface Result {
  username: string;
  password: string;
  userId: string;
  /** ADM-7: null when only the login was made. */
  event: { id: string; slug: string; name: string } | null;
}

const initialForm = {
  contactName: "",
  email: "",
  withEvent: true,
  eventName: "",
  eventDate: "",
  expiresAt: "",
  moderation: false,
  visibility: "public" as Visibility,
  galleryPassword: "",
  planKey: "event" as PlanKey,
};

export function QuickCreateForm() {
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  // TPL-1: the look, as on New event, so a provisioned wedding opens dressed.
  const [occasion, setOccasion] = useState<OccasionKey | null>(null);
  const [template, setTemplate] = useState("plain");
  const [colorway, setColorway] = useState<string | null>(null);
  const [lookFields, setLookFields] = useState<TemplateFields>({});
  const chosen = templateByKey(template);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactName: form.contactName,
          email: form.email || undefined,
          withEvent: form.withEvent,
          eventName: form.withEvent ? form.eventName : undefined,
          eventDate: form.eventDate || null,
          expiresAt: endOfDayIso(form.expiresAt),
          moderation: form.moderation,
          visibility: form.visibility,
          galleryPassword: form.visibility === "password" ? form.galleryPassword : undefined,
          planKey: form.planKey,
          template,
          colorway: colorway ?? undefined,
          templateFields: lookFieldsPayload(lookFields),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not create client");
        return;
      }

      setResult(await res.json());
    } catch {
      setError("Could not create the client. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyCredentials(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy automatically. Select the details above and copy them by hand.");
    }
  }

  if (result && !result.event) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const loginText = ["Klik login", `URL: ${origin}/login`, `Username: ${result.username}`, `Password: ${result.password}`].join("\n");
    return (
      <Card className="space-y-6">
        <div>
          <p className="text-sm font-medium text-volt">Login created</p>
          <h2 className="mt-1 font-display text-xl text-paper">{form.contactName}</h2>
          <p className="mt-1 text-sm text-muted">
            No event and no plan yet. It is waiting in &ldquo;Signed up, not activated&rdquo;; make their event and grant
            a plan from their page.
          </p>
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
          The password is shown once. Copy it now. It can only be changed later.
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted">Username</dt>
            <dd className="font-mono text-paper">{result.username}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted">Password</dt>
            <dd className="select-all font-mono text-paper">{result.password}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => void copyCredentials(loginText)}>
            {copied ? "Copied" : "Copy credentials"}
          </Button>
          <Link href={`/admin/clients/${result.userId}`} className={buttonClassName({ variant: "ghost" })}>
            Open their page
          </Link>
        </div>
      </Card>
    );
  }

  if (result && result.event) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const guestUrl = `${origin}/e/${result.event.slug}`;
    const credentialsText = [
      "Klik client login",
      `URL: ${origin}/login`,
      `Username: ${result.username}`,
      `Login password: ${result.password}`,
      "",
      "Guest gallery",
      `URL: ${guestUrl}`,
      ...(form.visibility === "password"
        ? [`Gallery password: ${form.galleryPassword}`]
        : []),
    ].join("\n");

    return (
      <Card className="space-y-6">
        <div>
          <p className="text-sm font-medium text-volt">Client provisioned</p>
          <h2 className="mt-1 font-display text-xl text-paper">{result.event.name}</h2>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
          The client login password is shown once. Copy it now. It can only be reset later.
        </div>
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted">Client username</dt>
            <dd className="font-mono text-paper">{result.username}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted">Client login password</dt>
            <dd className="font-mono text-paper">{result.password}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted">Gallery link</dt>
            <dd className="truncate font-mono text-paper">{guestUrl}</dd>
          </div>
          {form.visibility === "password" && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">Gallery password</dt>
              <dd className="font-mono text-paper">{form.galleryPassword}</dd>
            </div>
          )}
        </dl>

        <div className="rounded-2xl bg-paper p-4 text-center">
          <Image
            src={`/api/events/${result.event.id}/qr?format=png&size=480`}
            alt={`QR code for ${result.event.slug}`}
            width={220}
            height={220}
            unoptimized
            className="mx-auto"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => void copyCredentials(credentialsText)}>
            {copied ? "Copied" : "Copy credentials"}
          </Button>
          <a
            href={`/api/events/${result.event.id}/qr?format=png&size=1024`}
            download
            className={buttonClassName({ variant: "ghost" })}
          >
            Download QR
          </a>
          <Link
            href={`/dashboard/events/${result.event.id}`}
            className={buttonClassName({ variant: "ghost" })}
          >
            Open dashboard
          </Link>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setResult(null);
              setForm(initialForm);
              setOccasion(null);
              setTemplate("plain");
              setColorway(null);
              setLookFields({});
              setError(null);
              setCopied(false);
            }}
          >
            Provision another
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Venue / contact name" hint="Used to generate the login username">
          <input
            className={inputClass}
            value={form.contactName}
            onChange={(event) => setForm((f) => ({ ...f, contactName: event.target.value }))}
            required
            placeholder="Grand Palace Banquets"
          />
        </Field>
        <Field label="Email (optional)" hint="Where their access email, messages and receipts go">
          <input
            type="email"
            className={inputClass}
            value={form.email}
            onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))}
            maxLength={254}
            autoComplete="off"
            placeholder="hello@grandpalace.com"
          />
        </Field>
        <Checkbox
          checked={form.withEvent}
          onChange={(event) => setForm((f) => ({ ...f, withEvent: event.target.checked }))}
          hint="Untick to make only the login. You can add their events and grant a plan from their page."
        >
          Set up their first event now
        </Checkbox>
        {form.withEvent && (
          <>
            <OccasionPicker
              value={occasion}
              onChange={(next) => {
                setOccasion(next);
                setTemplate(templatesFor(next)[0]?.key ?? "plain");
                setColorway(null);
              }}
            />
            {occasion && (
              <TemplatePicker
                occasion={occasion}
                value={template}
                onChange={(next) => {
                  setTemplate(next.key);
                  setColorway(null);
                }}
                colorwayFor={(option) =>
                  option.key === template ? (option.colorways.find((item) => item.key === colorway) ?? null) : null
                }
              />
            )}
            {occasion && chosen && (
              <ColorwayPicker
                template={chosen}
                value={colorway ?? chosen.colorways[0].key}
                onChange={(next) => setColorway(next.key)}
              />
            )}
            {occasion && chosen && chosen.fields.length > 0 && (
              <LookFields template={chosen} value={lookFields} onChange={setLookFields} showDateToggle={false} idPrefix="admin-look" />
            )}
            <Field label="Event name">
              <input
                className={inputClass}
                value={form.eventName}
                onChange={(event) => setForm((f) => ({ ...f, eventName: event.target.value }))}
                required
                placeholder="Anita & Raj's wedding"
              />
            </Field>
            <Field label="Plan" hint="The plan controls event count, upload window, and video size">
              <select
                className={inputClass}
                value={form.planKey}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    planKey: event.target.value as PlanKey,
                  }))
                }
              >
                {Object.values(PLANS).map((plan) => (
                  <option key={plan.key} value={plan.key}>
                    {plan.name} · {plan.maxActiveEvents} active{" "}
                    {plan.maxActiveEvents === 1 ? "event" : "events"} · {plan.maxEventsPerMonth}/month
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Event date (optional)">
                <input
                  type="date"
                  className={inputClass}
                  value={form.eventDate}
                  onChange={(event) => setForm((f) => ({ ...f, eventDate: event.target.value }))}
                />
              </Field>
              <Field label="Expires on (optional)" hint="The gallery closes at the end of this day">
                <input
                  type="date"
                  className={inputClass}
                  value={form.expiresAt}
                  onChange={(event) => setForm((f) => ({ ...f, expiresAt: event.target.value }))}
                />
              </Field>
            </div>
            <VisibilityField
              value={form.visibility}
              onChange={(visibility) => setForm((f) => ({ ...f, visibility }))}
            />
            {form.visibility === "password" && (
              <Field
                label="Gallery password"
                hint="Guests will enter this password after scanning the QR code"
                htmlFor="admin-gallery-password"
              >
                <PasswordInput
                  id="admin-gallery-password"
                  value={form.galleryPassword}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, galleryPassword: event.target.value }))
                  }
                  autoComplete="new-password"
                  minLength={4}
                  maxLength={72}
                  required
                />
              </Field>
            )}
            <Checkbox
              checked={form.moderation}
              onChange={(event) => setForm((f) => ({ ...f, moderation: event.target.checked }))}
            >
              Review photos before they go public
            </Checkbox>
          </>
        )}
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Provisioning…" : form.withEvent ? "Provision client" : "Create the login"}
        </Button>
      </form>
    </Card>
  );
}
