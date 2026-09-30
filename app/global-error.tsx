"use client";

/**
 * Catches failures in the root layout itself, where app/error.tsx cannot reach.
 * It replaces the whole document, so it ships its own <html> and <body> and
 * cannot rely on the fonts or Tailwind tokens the layout normally provides.
 * That is why the styles here are inline and the palette is hard-coded: this
 * file has to render when everything else has failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.25rem",
          padding: "1.5rem",
          textAlign: "center",
          background: "#050505",
          color: "#f3f1e9",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <h1 style={{ fontSize: "1.75rem", fontWeight: 600, margin: 0 }}>Klik is not loading</h1>
        <p style={{ maxWidth: "28rem", color: "#8c8a80", lineHeight: 1.6, margin: 0 }}>
          Something failed before the page could start. Nothing you uploaded has been lost.
        </p>
        <button
          onClick={reset}
          style={{
            border: "none",
            borderRadius: "9999px",
            padding: "0.75rem 1.75rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            background: "#edee00",
            color: "#050505",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
        {error.digest && (
          <p style={{ fontSize: "0.75rem", color: "#8c8a80", margin: 0 }}>
            Reference: {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
