"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { USERNAME_CHANGE_DAYS, USERNAME_MAX, validateUsername } from "@/lib/username";

type Status = { state: "idle" } | { state: "checking" } | { state: "free" } | { state: "unavailable"; reason: string };

/**
 * ID-2. The rules are checked here as the person types, from the same function
 * the server uses, and only a handle that passes them costs a request.
 */
export function UsernameForm({
  initialUsername,
  canChange,
  nextChangeAt,
  suggestions,
}: {
  initialUsername: string | null;
  canChange: boolean;
  nextChangeAt: string | null;
  suggestions: string[];
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(initialUsername);
  const [value, setValue] = useState(initialUsername ?? "");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [locked, setLocked] = useState(!canChange);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const local = validateUsername(value);
  const unchanged = local.ok && local.username === current?.toLowerCase();

  useEffect(() => {
    if (!local.ok || unchanged || locked) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      setStatus({ state: "checking" });
      const result = await apiRequest<{ available: boolean; reason: string | null }>(
        `/api/username/available?u=${encodeURIComponent(local.username)}`,
        {},
        "Could not check that username",
      );
      if (ticket !== latest.current) return;
      if (!result.ok) setStatus({ state: "unavailable", reason: result.error });
      else if (result.data.available) setStatus({ state: "free" });
      else setStatus({ state: "unavailable", reason: result.data.reason ?? "Taken." });
    }, 350);
    return () => clearTimeout(timer);
    // `local` is derived from `value`; depending on the string keeps one check per edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, unchanged, locked]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!local.ok) return;
    setBusy(true);
    setError(null);
    const result = await apiRequest<{ account: { username: string } }>(
      `/api/me`,
      { method: "PATCH", body: { username: local.username } },
      "Could not change your username",
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCurrent(result.data.account.username);
    setValue(result.data.account.username);
    setStatus({ state: "idle" });
    setLocked(true);
    router.refresh();
  }

  const hint = !local.ok
    ? value
      ? local.reason
      : "Letters, numbers and underscores, starting with a letter."
    : unchanged
      ? "This is your username."
      : status.state === "checking"
        ? "Checking…"
        : status.state === "free"
          ? "Available."
          : status.state === "unavailable"
            ? status.reason
            : "";

  return (
    <form onSubmit={save} className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-paper">Username</h2>
        <p className="mt-1 text-xs text-muted">
          How other organizers find you to add you to an event, and what you can sign in with. You
          can change it once every {USERNAME_CHANGE_DAYS} days, and the old one stays yours for{" "}
          {USERNAME_CHANGE_DAYS} days after.
        </p>
      </div>
      {locked ? (
        <p className="text-sm text-paper">
          @{current}
          {nextChangeAt && (
            <span className="ml-2 text-xs text-muted">
              You can change it again on{" "}
              {new Date(nextChangeAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.
            </span>
          )}
        </p>
      ) : (
        <>
          <Field label="Username" htmlFor="account-username">
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">@</span>
              <input
                id="account-username"
                className={`${inputClass} pl-8`}
                value={value}
                onChange={(event) => setValue(event.target.value.toLowerCase())}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                spellCheck={false}
                maxLength={USERNAME_MAX + 1}
                aria-describedby="account-username-hint"
              />
            </div>
            <p
              id="account-username-hint"
              className={`mt-1.5 flex items-center gap-1.5 text-xs ${
                status.state === "free" && !unchanged && local.ok ? "text-volt" : "text-muted"
              }`}
              aria-live="polite"
            >
              {status.state === "free" && !unchanged && local.ok && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
              {hint}
            </p>
          </Field>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Ideas:</span>
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setValue(suggestion)}
                  className="min-h-9 rounded-full border border-canvas-line px-3 text-xs text-paper transition-colors hover:border-volt/50 hover:text-volt"
                >
                  @{suggestion}
                </button>
              ))}
            </div>
          )}
          <Button type="submit" size="sm" disabled={busy || !local.ok || unchanged || status.state !== "free"}>
            Change username
          </Button>
        </>
      )}
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
