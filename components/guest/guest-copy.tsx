"use client";

import { createContext, useContext, type ReactNode } from "react";
import { GUEST_COPY, type GuestCopy } from "@/lib/i18n/guest";
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, LOCALE_NAMES, type Locale } from "@/lib/i18n/locale";

/**
 * TRS-3: the guest-facing screens' words, for the language the server chose.
 * The locale is the only thing passed down from the server; the dictionaries
 * are imported here, because their plurals are functions and functions cannot
 * cross from a server component.
 */
const GuestCopyContext = createContext<{ locale: Locale; t: GuestCopy }>({
  locale: DEFAULT_LOCALE,
  t: GUEST_COPY[DEFAULT_LOCALE],
});

export function GuestCopyProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <GuestCopyContext.Provider value={{ locale, t: GUEST_COPY[locale] }}>{children}</GuestCopyContext.Provider>;
}

/** The words for the current guest's language, and which language that is. */
export function useGuestCopy() {
  return useContext(GuestCopyContext);
}

/**
 * The guest's own choice of language, kept for a year on this phone. Each
 * name is written in its own language, so it can be found by someone who
 * cannot read the current one.
 */
function rememberLocale(next: Locale) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${next}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`;
  window.location.reload();
}

export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { locale, t } = useGuestCopy();
  function choose(next: Locale) {
    if (next !== locale) rememberLocale(next);
  }
  return (
    <nav aria-label={t.common.language} className={`flex items-center justify-center gap-1 text-xs ${className}`}>
      {LOCALES.map((option, index) => (
        <span key={option} className="flex items-center gap-1">
          {index > 0 && <span aria-hidden="true" className="text-muted">·</span>}
          <button
            type="button"
            lang={option}
            onClick={() => choose(option)}
            aria-current={option === locale ? "true" : undefined}
            className={`min-h-11 px-1.5 underline-offset-2 transition-colors ${
              option === locale ? "font-medium text-paper" : "text-muted hover:text-paper hover:underline"
            }`}
          >
            {LOCALE_NAMES[option]}
          </button>
        </span>
      ))}
    </nav>
  );
}
