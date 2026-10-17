"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, inputClass } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { VisibilityField, type Visibility } from "@/components/dashboard/visibility-field";
import { ColorwayPicker, OccasionPicker, TemplatePicker } from "@/components/dashboard/template-picker";
import { LookFields, lookFieldsPayload } from "@/components/dashboard/look-fields";
import { OCCASIONS, templateByKey, templatesFor, type OccasionKey, type TemplateFields } from "@/lib/gallery-templates";

/**
 * ADM-7: a new event on this account, made by Klik. It is a draft, like any
 * other new event: "Put this event live" beside it is the grant.
 */
export function NewEventForAccount({ userId }: { userId: string }) {
  const router = useRouter();
  const [occasion, setOccasion] = useState<OccasionKey | null>(null);
  const [template, setTemplate] = useState("plain");
  const [colorway, setColorway] = useState<string | null>(null);
  const [lookFields, setLookFields] = useState<TemplateFields>({});
  const [name, setName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [password, setPassword] = useState("");
  const [moderation, setModeration] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const chosen = templateByKey(template);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/clients/${encodeURIComponent(userId)}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          eventDate: eventDate || null,
          visibility,
          password: visibility === "password" ? password : undefined,
          moderation,
          template,
          colorway: colorway ?? undefined,
          templateFields: lookFieldsPayload(lookFields),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not create the event");
        return;
      }
      setMade(data.event?.name ?? name);
      setName("");
      setEventDate("");
      setLookFields({});
      setOccasion(null);
      setTemplate("plain");
      setColorway(null);
      router.refresh();
    } catch {
      setError("Could not create the event. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {made && (
        <p className="rounded-xl border border-volt/30 bg-volt/5 px-4 py-3 text-sm text-paper" role="status">
          &ldquo;{made}&rdquo; is on their account as a draft. Put it live from its row when it is paid for.
        </p>
      )}
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
        <ColorwayPicker template={chosen} value={colorway ?? chosen.colorways[0].key} onChange={(next) => setColorway(next.key)} />
      )}
      {occasion && chosen && chosen.fields.length > 0 && (
        <LookFields template={chosen} value={lookFields} onChange={setLookFields} showDateToggle={false} idPrefix={`admin-new-${userId}`} />
      )}
      <Field label="Event name">
        <input
          className={inputClass}
          value={name}
          onChange={(change) => setName(change.target.value)}
          placeholder={OCCASIONS.find((option) => option.key === occasion)?.namePlaceholder ?? "Anita & Raj's wedding"}
          maxLength={120}
          required
        />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Event date (optional)">
          <input type="date" className={inputClass} value={eventDate} onChange={(change) => setEventDate(change.target.value)} />
        </Field>
        <VisibilityField value={visibility} onChange={setVisibility} />
      </div>
      {visibility === "password" && (
        <Field label="Gallery password" htmlFor={`admin-new-password-${userId}`}>
          <PasswordInput
            id={`admin-new-password-${userId}`}
            value={password}
            onChange={(change) => setPassword(change.target.value)}
            autoComplete="new-password"
            minLength={4}
            maxLength={72}
            required
          />
        </Field>
      )}
      <Checkbox checked={moderation} onChange={(change) => setModeration(change.target.checked)}>
        Review photos before they go public
      </Checkbox>
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={saving}>
        {saving ? "Creating…" : "Create the event"}
      </Button>
    </form>
  );
}
