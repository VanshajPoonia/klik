"use client";

import { useEffect, type RefObject } from "react";

/**
 * TRS-3: what every sheet and full-screen view owes a keyboard or screen
 * reader. On open, focus moves inside (to `initial`, else the first control,
 * else the container itself). While open, Tab and Shift+Tab stay inside, so
 * focus never wanders onto the page underneath. On close, focus goes back to
 * whatever opened it.
 *
 * Dialogs nest (a share panel inside the lightbox), so the open ones form a
 * stack and only the top one traps Tab. A panel that is not modal (a sheet
 * inside the viewer, or the photo editor, whose own popovers live outside its
 * box) passes `trap: false` and only moves focus in and back. Escape is left
 * to each component, which already knows what closing means for it.
 */

const stack: HTMLElement[] = [];

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.hasAttribute("inert") && element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0,
  );
}

export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  {
    active = true,
    initial,
    trap = true,
  }: { active?: boolean; initial?: RefObject<HTMLElement | null>; trap?: boolean } = {},
) {
  useEffect(() => {
    const container = ref.current;
    if (!active || !container) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (trap) stack.push(container);

    // After paint, so a control that renders on open exists to be focused.
    const frame = window.requestAnimationFrame(() => {
      if (container.contains(document.activeElement)) return;
      const target = initial?.current ?? focusables(container)[0] ?? container;
      if (target === container && !container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || stack[stack.length - 1] !== container || !container) return;
      const items = focusables(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const inside = container.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    }
    if (trap) document.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      if (trap) document.removeEventListener("keydown", onKeyDown);
      const index = stack.lastIndexOf(container);
      if (index !== -1) stack.splice(index, 1);
      // Back to whatever opened it, if it is still on the page.
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [ref, active, initial, trap]);
}
