"use client";

import { useCallback, useReducer } from "react";
import type { PrintDoc } from "@/lib/print/doc";

/**
 * QR-4b: undo and redo, as a stack of whole designs. A design is small, so
 * keeping each state outright is simpler and safer than replaying edits.
 *
 * Changes that share a key within a moment (typing into one field, nudging
 * with the arrow keys) fold into one step, so undo takes back the word, not
 * the letter.
 */

const LIMIT = 100;
const COALESCE_MS = 900;

interface History {
  past: PrintDoc[];
  present: PrintDoc;
  future: PrintDoc[];
  lastKey: string | null;
  lastAt: number;
  /** Counts every change the host made, for autosave to notice. */
  version: number;
}

type Action =
  | { type: "change"; doc: PrintDoc; key?: string }
  | { type: "silent"; doc: PrintDoc }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; doc: PrintDoc };

function reducer(state: History, action: Action): History {
  switch (action.type) {
    case "change": {
      if (action.doc === state.present) return state;
      const now = Date.now();
      const fold = action.key != null && action.key === state.lastKey && now - state.lastAt < COALESCE_MS;
      return {
        past: fold ? state.past : [...state.past, state.present].slice(-LIMIT),
        present: action.doc,
        future: [],
        lastKey: action.key ?? null,
        lastAt: now,
        version: state.version + 1,
      };
    }
    case "silent":
      // A measurement, not an edit: the text's height after its font loaded.
      // Saved with the next change, never undone on its own.
      return { ...state, present: action.doc };
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        lastKey: null,
        lastAt: 0,
        version: state.version + 1,
      };
    }
    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return {
        past: [...state.past, state.present],
        present: next,
        future: rest,
        lastKey: null,
        lastAt: 0,
        version: state.version + 1,
      };
    }
    case "reset":
      return { past: [], present: action.doc, future: [], lastKey: null, lastAt: 0, version: state.version };
  }
}

export function useDocHistory(initial: PrintDoc) {
  const [state, dispatch] = useReducer(reducer, {
    past: [],
    present: initial,
    future: [],
    lastKey: null,
    lastAt: 0,
    version: 0,
  });
  return {
    doc: state.present,
    version: state.version,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    change: useCallback((doc: PrintDoc, key?: string) => dispatch({ type: "change", doc, key }), []),
    silent: useCallback((doc: PrintDoc) => dispatch({ type: "silent", doc }), []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
    reset: useCallback((doc: PrintDoc) => dispatch({ type: "reset", doc }), []),
  };
}
