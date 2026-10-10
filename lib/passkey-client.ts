import {
  WebAuthnAbortService,
  WebAuthnError,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  sendSignal,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { signIn } from "next-auth/react";
import type { PasskeySummary } from "./passkeys";

/**
 * ACC-6, the browser half. Every function here resolves to an outcome rather
 * than throwing, and an outcome with `error: null` means the person closed the
 * prompt, which is a choice and gets no red text.
 */

export type PasskeyOutcome = { ok: true } | { ok: false; error: string | null };

export { browserSupportsWebAuthn as passkeysSupported, browserSupportsWebAuthnAutofill as passkeyAutofillSupported };

/** Whether this device can make a passkey with its own lock (Face ID, fingerprint, PIN). */
export async function deviceCanHoldPasskey(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

/** Stops a pending autofill prompt, so a page that is leaving does not leave one behind. */
export function cancelPasskeyPrompt() {
  WebAuthnAbortService.cancelCeremony();
}

function cancelled(error: unknown): boolean {
  if (error instanceof WebAuthnError) {
    if (error.code === "ERROR_CEREMONY_ABORTED") return true;
    return error.name === "NotAllowedError" || error.name === "AbortError";
  }
  return error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError");
}

async function ceremony(purpose: "register" | "signin"): Promise<{ options: unknown; userHandle?: string } | { error: string }> {
  try {
    const response = await fetch("/api/passkeys/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose }),
    });
    const body = (await response.json().catch(() => null)) as { options?: unknown; userHandle?: string; error?: string } | null;
    if (!response.ok || !body?.options) return { error: body?.error ?? "Passkeys are not working right now. Try again." };
    return { options: body.options, userHandle: body.userHandle };
  } catch {
    return { error: "Could not reach Klik. Check your connection and try again." };
  }
}

/**
 * Signs in with a passkey. With `autofill`, the prompt waits quietly in the
 * email field's suggestions until the person picks a passkey there, and the
 * promise stays pending until then.
 */
export async function signInWithPasskey({ autofill = false }: { autofill?: boolean } = {}): Promise<PasskeyOutcome> {
  const started = await ceremony("signin");
  if ("error" in started) return { ok: false, error: autofill ? null : started.error };

  let answer;
  try {
    answer = await startAuthentication({
      optionsJSON: started.options as Parameters<typeof startAuthentication>[0]["optionsJSON"],
      useBrowserAutofill: autofill,
    });
  } catch (error) {
    return { ok: false, error: cancelled(error) || autofill ? null : "That passkey did not work. Try again." };
  }

  try {
    const result = await signIn("passkey", { response: JSON.stringify(answer), redirect: false });
    if (result && !result.error) return { ok: true };
    if (result?.code === "passkey_unknown") {
      // Removed from the account, still on the phone. Asking the phone to
      // forget it stops it being offered again, where the browser can.
      await sendSignal({ signalName: "unknownCredential", rpID: window.location.hostname, credentialID: answer.id }).catch(() => undefined);
      return { ok: false, error: "That passkey was removed from its account. Sign in another way, then add a new one." };
    }
    if (result?.code === "passkey_expired") return { ok: false, error: "That took too long. Try again." };
    return { ok: false, error: "That passkey did not work. Try again, or sign in with an email code." };
  } catch {
    return { ok: false, error: "Could not reach Klik. Check your connection and try again." };
  }
}

export type AddOutcome = { ok: true; passkey: PasskeySummary } | { ok: false; error: string | null };

/** Makes a passkey on this device for the signed-in account and saves it. */
export async function addPasskey(): Promise<AddOutcome> {
  const started = await ceremony("register");
  if ("error" in started) return { ok: false, error: started.error };

  let answer;
  try {
    answer = await startRegistration({
      optionsJSON: started.options as Parameters<typeof startRegistration>[0]["optionsJSON"],
    });
  } catch (error) {
    if (error instanceof WebAuthnError && error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
      return { ok: false, error: "This device already has a passkey for your account." };
    }
    if (cancelled(error)) return { ok: false, error: null };
    return { ok: false, error: "This device could not make a passkey. Try again." };
  }

  try {
    const response = await fetch("/api/passkeys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: answer }),
    });
    const body = (await response.json().catch(() => null)) as { passkey?: PasskeySummary; error?: string } | null;
    if (!response.ok || !body?.passkey) return { ok: false, error: body?.error ?? "Could not save the passkey. Try again." };
    return { ok: true, passkey: body.passkey };
  } catch {
    return { ok: false, error: "Could not reach Klik. Check your connection and try again." };
  }
}

/**
 * Tells this device which of the account's passkeys still work, so one removed
 * here stops appearing in its list. Best effort: most browsers ignore it today.
 */
export async function syncPasskeyList(userHandle: string, ids: string[]) {
  await sendSignal({
    signalName: "allAcceptedCredentials",
    rpID: window.location.hostname,
    userID: userHandle,
    allAcceptedCredentialIDs: ids,
  }).catch(() => undefined);
}
