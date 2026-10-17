"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, inputClass } from "@/components/ui/field";
import { TEMPLATE_FIELD_LIMITS, type GalleryTemplate, type TemplateFields } from "@/lib/gallery-templates";

/**
 * TPL-1: the few words a look asks its host for, and nothing else. Used on
 * New event, on the Look tab and on /admin/new, so a couple types their names
 * once wherever the gallery is set up.
 *
 * Every field is optional: a look with nothing filled in is headed with the
 * event's name, so nobody has to finish this to get a gallery.
 */
export function LookFields({
  template,
  value,
  onChange,
  showDateToggle = true,
  idPrefix = "look",
}: {
  template: GalleryTemplate;
  value: TemplateFields;
  onChange: (next: TemplateFields) => void;
  /** Off where there is no date yet to show or hide. */
  showDateToggle?: boolean;
  idPrefix?: string;
}) {
  if (template.fields.length === 0) return null;
  const set = (patch: Partial<TemplateFields>) => onChange({ ...value, ...patch });
  const sample = template.sample;
  const names = value.names ?? ["", ""];

  return (
    <div className="space-y-4">
      {template.fields.includes("names") && (
        <fieldset>
          <legend className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
            Your names, as guests will see them
          </legend>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <input
              className={inputClass}
              value={names[0]}
              onChange={(event) => set({ names: [event.target.value, names[1]] })}
              placeholder={sample.names?.[0] ?? "Ana"}
              maxLength={TEMPLATE_FIELD_LIMITS.name}
              aria-label="First name"
              autoComplete="off"
            />
            <span className="font-display text-lg italic text-muted" aria-hidden="true">
              &amp;
            </span>
            <input
              className={inputClass}
              value={names[1]}
              onChange={(event) => set({ names: [names[0], event.target.value] })}
              placeholder={sample.names?.[1] ?? "Bo"}
              maxLength={TEMPLATE_FIELD_LIMITS.name}
              aria-label="Second name"
              autoComplete="off"
            />
          </div>
        </fieldset>
      )}

      {(template.fields.includes("name") || template.fields.includes("age")) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_8rem]">
          {template.fields.includes("name") && (
            <Field label={template.key === "diploma" ? "The graduate" : "Whose birthday"}>
              <input
                className={inputClass}
                value={value.name ?? ""}
                onChange={(event) => set({ name: event.target.value })}
                placeholder={sample.name}
                maxLength={TEMPLATE_FIELD_LIMITS.name}
                autoComplete="off"
              />
            </Field>
          )}
          {template.fields.includes("age") && (
            <Field label="Turning" hint="Shown as a big number. Leave it empty to leave it out.">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={129}
                className={inputClass}
                value={value.age ?? ""}
                onChange={(event) => {
                  const age = Number.parseInt(event.target.value, 10);
                  set({ age: Number.isFinite(age) && age > 0 && age < 130 ? age : undefined });
                }}
                placeholder={sample.age ? String(sample.age) : "30"}
              />
            </Field>
          )}
        </div>
      )}

      {(template.fields.includes("classOf") || template.fields.includes("school")) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[8rem_1fr]">
          {template.fields.includes("classOf") && (
            <Field label="Class of">
              <input
                className={inputClass}
                value={value.classOf ?? ""}
                onChange={(event) => set({ classOf: event.target.value })}
                placeholder={sample.classOf}
                maxLength={TEMPLATE_FIELD_LIMITS.classOf}
                autoComplete="off"
              />
            </Field>
          )}
          {template.fields.includes("school") && (
            <Field label="School (optional)">
              <input
                className={inputClass}
                value={value.school ?? ""}
                onChange={(event) => set({ school: event.target.value })}
                placeholder={sample.school}
                maxLength={TEMPLATE_FIELD_LIMITS.school}
                autoComplete="off"
              />
            </Field>
          )}
        </div>
      )}

      {template.fields.includes("headline") && (
        <Field label="Headline" hint="Leave it empty to use the event's name.">
          <input
            className={inputClass}
            value={value.headline ?? ""}
            onChange={(event) => set({ headline: event.target.value })}
            placeholder={sample.headline}
            maxLength={TEMPLATE_FIELD_LIMITS.headline}
            autoComplete="off"
          />
        </Field>
      )}

      {template.fields.includes("message") && (
        <Field label="A line under it (optional)">
          <input
            className={inputClass}
            value={value.message ?? ""}
            onChange={(event) => set({ message: event.target.value })}
            placeholder={sample.message ?? "Thank you for coming"}
            maxLength={TEMPLATE_FIELD_LIMITS.message}
            autoComplete="off"
          />
        </Field>
      )}

      {showDateToggle && (
        <Checkbox
          id={`${idPrefix}-show-date`}
          checked={value.showDate !== false}
          onChange={(event) => set({ showDate: event.target.checked ? undefined : false })}
        >
          Show the date under the names
        </Checkbox>
      )}
    </div>
  );
}

/** What to send: the words as typed, with empty ones left out. */
export function lookFieldsPayload(value: TemplateFields): TemplateFields {
  const out: TemplateFields = {};
  const names = value.names ? ([value.names[0].trim(), value.names[1].trim()] as [string, string]) : null;
  if (names && (names[0] || names[1])) out.names = names;
  for (const key of ["name", "classOf", "school", "headline", "message"] as const) {
    const text = value[key]?.trim();
    if (text) out[key] = text;
  }
  if (value.age) out.age = value.age;
  if (value.showDate === false) out.showDate = false;
  return out;
}
