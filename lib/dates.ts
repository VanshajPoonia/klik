/** Value for an <input type="date">, in the viewer's local calendar. */
export function toDateInputValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** An "expires on" date should include that whole day, so store the last
 * moment of it in the viewer's timezone rather than midnight at its start. */
export function endOfDayIso(dateInput: string): string | null {
  if (!dateInput) return null;
  return new Date(`${dateInput}T23:59:59.999`).toISOString();
}
