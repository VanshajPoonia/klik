"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { PLANS, type PlanKey } from "@/lib/plans";

type Visibility = "public" | "password" | "private";

interface Result {
  username: string;
  password: string;
  event: { id: string; slug: string; name: string };
}

const initialForm = {
  contactName: "",
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/admin/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactName: form.contactName,
        eventName: form.eventName,
        eventDate: form.eventDate || null,
        expiresAt: form.expiresAt || null,
        moderation: form.moderation,
        visibility: form.visibility,
        galleryPassword: form.visibility === "password" ? form.galleryPassword : undefined,
        planKey: form.planKey,
      }),
    });

    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not create client");
      return;
    }

    setResult(await res.json());
  }

  if (result) {
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
          <Button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(credentialsText);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied!" : "Copy credentials"}
          </Button>
          <a href={`/api/events/${result.event.id}/qr?format=png&size=1024`} download>
            <Button type="button" variant="ghost">
              Download QR
            </Button>
          </a>
          <Link href={`/dashboard/events/${result.event.id}`}>
            <Button type="button" variant="ghost">
              Open dashboard
            </Button>
          </Link>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setResult(null);
              setForm(initialForm);
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
                {plan.maxActiveEvents === 1 ? "event" : "events"}
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
          <Field label="Expires on (optional)">
            <input
              type="date"
              className={inputClass}
              value={form.expiresAt}
              onChange={(event) => setForm((f) => ({ ...f, expiresAt: event.target.value }))}
            />
          </Field>
        </div>
        <Field label="Gallery access">
          <select
            className={inputClass}
            value={form.visibility}
            onChange={(event) =>
              setForm((f) => ({ ...f, visibility: event.target.value as Visibility }))
            }
          >
            <option value="public">Public - anyone with the link</option>
            <option value="password">Password protected</option>
            <option value="private">Private - organizer only</option>
          </select>
        </Field>
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
        <label className="flex items-center gap-2 text-sm text-paper">
          <input
            type="checkbox"
            checked={form.moderation}
            onChange={(event) => setForm((f) => ({ ...f, moderation: event.target.checked }))}
            className="h-4 w-4 rounded border-canvas-line accent-volt"
          />
          Review photos before they go public
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Provisioning…" : "Provision client"}
        </Button>
      </form>
    </Card>
  );
}
