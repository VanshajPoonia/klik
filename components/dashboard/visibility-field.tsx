import { Field, inputClass } from "@/components/ui/field";

export type Visibility = "public" | "password" | "private";

export function VisibilityField({
  value,
  onChange,
}: {
  value: Visibility;
  onChange: (next: Visibility) => void;
}) {
  return (
    <Field label="Gallery access">
      <select
        className={inputClass}
        value={value}
        onChange={(event) => onChange(event.target.value as Visibility)}
      >
        <option value="public">Public: anyone with the link</option>
        <option value="password">Password protected</option>
        <option value="private">Private: organizer only</option>
      </select>
    </Field>
  );
}
