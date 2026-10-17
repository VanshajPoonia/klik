import type { ReactNode } from "react";
import {
  templateByKey,
  templateHeading,
  PLAIN_TEMPLATE,
  type TemplateFields,
  type TemplateKey,
} from "@/lib/gallery-templates";

/**
 * TPL-1: the top of a gallery in its look. What a guest sees first after
 * scanning, on the entry sheet ("sheet"), then over the photos ("page"), and
 * drawn small in the dashboard's picker ("card") from the same markup, so the
 * preview is the truth.
 *
 * Only type, composition and ornament live here. Colour is the gallery's own
 * tokens (volt, paper, muted), already held to WCAG AA for whatever colourway
 * or Premium colours the host chose, and the sizes are `.look-hero` in
 * app/globals.css, set against the width this sits in rather than the screen.
 *
 * Plain is not drawn here: its galleries keep the header they always had.
 */
export type LookSize = "page" | "sheet" | "card";

export function LookHero({
  templateKey,
  fields,
  eventName,
  eventDate,
  locale,
  size,
  heading = "h1",
  children,
}: {
  templateKey: TemplateKey;
  fields: TemplateFields;
  eventName: string;
  eventDate: string | Date | null;
  locale: "en" | "es";
  size: LookSize;
  /** The dashboard draws several, so only one may be the page's heading. */
  heading?: "h1" | "p";
  /** Under everything: the count of what is shared, on the gallery page. */
  children?: ReactNode;
}) {
  const template = templateByKey(templateKey) ?? PLAIN_TEMPLATE;
  const { names, title } = templateHeading(template, fields, eventName);
  const date = fields.showDate === false ? null : formatLookDate(eventDate, template.key, locale);
  // The picker's cards are radio labels, which may hold only phrasing
  // content, so there every block is a span (display: block in the CSS).
  const card = size === "card";
  const Heading = card ? "span" : heading;
  const Block = card ? "span" : "div";
  const P = card ? "span" : "p";
  const message = fields.message ? <P className="look-message">{fields.message}</P> : null;

  if (template.key === "black-tie") {
    return (
      <Block className="look-stage">
        <Block className="look-hero" data-look="black-tie" data-size={size}>
          <DecoFan />
          <Heading className="look-title">
            {names ? (
              <>
                {names[0]} <span className="look-amp">&amp;</span> {names[1]}
              </>
            ) : (
              title
            )}
          </Heading>
          {date && <P className="look-date">{date}</P>}
          {message}
          {children}
        </Block>
      </Block>
    );
  }

  if (template.key === "white-lace") {
    return (
      <Block className="look-stage">
        <Block className="look-hero" data-look="white-lace" data-size={size}>
          <Heading className="look-title">
            {names ? (
              <>
                <span className="look-name">{names[0]}</span>{" "}
                <span className="look-amp">&amp;</span>{" "}
                <span className="look-name">{names[1]}</span>
              </>
            ) : (
              title
            )}
          </Heading>
          <Sprig />
          {date && <P className="look-date">{date}</P>}
          {message}
          {children}
        </Block>
      </Block>
    );
  }

  if (template.key === "party") {
    return (
      <Block className="look-stage">
        <Block className="look-hero" data-look="party" data-size={size}>
          <Confetti />
          <Block className="look-party">
            {fields.age && (
              <span className="look-age" aria-hidden="true">
                {fields.age}
              </span>
            )}
            <Block className="look-party-words">
              <Heading className="look-title">
                {title}
                {fields.age && (
                  <span className="sr-only">
                    {locale === "es" ? `, ${fields.age} años` : `, ${fields.age}`}
                  </span>
                )}
              </Heading>
              {date && <P className="look-date">{date}</P>}
            </Block>
          </Block>
          {message}
          {children}
        </Block>
      </Block>
    );
  }

  if (template.key === "diploma") {
    return (
      <Block className="look-stage">
        <Block className="look-hero" data-look="diploma" data-size={size}>
          <Block className="look-frame">
            <Heading className="look-title">{title}</Heading>
            {fields.classOf && (
              <P className="look-class">
                <Laurel />
                <span>{locale === "es" ? `Generación ${fields.classOf}` : `Class of ${fields.classOf}`}</span>
                <Laurel mirrored />
              </P>
            )}
            {fields.school && <P className="look-school">{fields.school}</P>}
            {date && <P className="look-date">{date}</P>}
          </Block>
          {message}
          {children}
        </Block>
      </Block>
    );
  }

  return (
    <Block className="look-stage">
      <Block className="look-hero" data-look="modern" data-size={size}>
        <Heading className="look-title">{title}</Heading>
        <span className="look-rule" aria-hidden="true" />
        {date && <P className="look-date">{date}</P>}
        {message}
        {children}
      </Block>
    </Block>
  );
}

/**
 * The date the way each look would print it. Event dates are stored as the
 * midnight UTC a date picker gives, so they are read in UTC: anywhere west of
 * London would otherwise put the wedding on the Friday.
 */
export function formatLookDate(value: string | Date | null, look: TemplateKey, locale: "en" | "es"): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const options: Intl.DateTimeFormatOptions =
    look === "party"
        ? { weekday: "long", month: "long", day: "numeric" }
        : { month: "long", day: "numeric", year: "numeric" };
  return date.toLocaleDateString(locale === "es" ? "es-US" : "en-US", { ...options, timeZone: "UTC" });
}

/** Black tie: an Art Deco fan over the names, drawn in hairline gold. */
function DecoFan() {
  const rays = Array.from({ length: 11 }, (_, index) => {
    const angle = ((195 + index * 15) * Math.PI) / 180;
    return {
      x1: 40 + 13 * Math.cos(angle),
      y1: 32 + 13 * Math.sin(angle),
      x2: 40 + 27 * Math.cos(angle),
      y2: 32 + 27 * Math.sin(angle),
    };
  });
  return (
    <svg className="look-ornament look-fan" viewBox="0 0 80 34" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M8 32 A32 32 0 0 1 72 32" strokeWidth="0.8" />
      <path d="M29 32 A11 11 0 0 1 51 32" strokeWidth="0.8" />
      {rays.map((ray, index) => (
        <line key={index} {...ray} strokeWidth="0.7" />
      ))}
      <path d="M0 32 H80" strokeWidth="0.6" />
      <circle cx="40" cy="32" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** White lace: a sprig of leaves either side of a single pearl. */
function Sprig() {
  const leaves = [
    { x: 47, y: 10.4, r: -28 },
    { x: 39.5, y: 13.6, r: 26 },
    { x: 32, y: 10.2, r: -24 },
    { x: 24.5, y: 13.4, r: 24 },
    { x: 17, y: 10.6, r: -20 },
    { x: 10.5, y: 13.1, r: 18 },
  ];
  const branch = (
    <>
      <path d="M55 12 C 44 12.2, 28 11.4, 6 12.6" fill="none" stroke="currentColor" strokeWidth="0.7" />
      {leaves.map((leaf, index) => (
        <ellipse
          key={index}
          cx={leaf.x}
          cy={leaf.y}
          rx="4.2"
          ry="1.7"
          transform={`rotate(${leaf.r} ${leaf.x} ${leaf.y})`}
          fill="currentColor"
          opacity="0.85"
        />
      ))}
    </>
  );
  return (
    <svg className="look-ornament look-sprig" viewBox="0 0 120 24" aria-hidden="true">
      {branch}
      <g transform="translate(120 0) scale(-1 1)">{branch}</g>
      <circle cx="60" cy="12" r="2.1" fill="currentColor" />
    </svg>
  );
}

/** Party: confetti thrown over the top corner, in the accent and the paper colour. */
function Confetti() {
  const pieces: Array<{ kind: "dot" | "strip" | "wave" | "tri"; x: number; y: number; r: number; paper?: boolean; o?: number }> = [
    { kind: "dot", x: 182, y: 14, r: 0 },
    { kind: "strip", x: 150, y: 22, r: 32, paper: true },
    { kind: "wave", x: 112, y: 10, r: -12 },
    { kind: "dot", x: 132, y: 46, r: 0, paper: true, o: 0.7 },
    { kind: "tri", x: 172, y: 52, r: 18 },
    { kind: "strip", x: 96, y: 34, r: -40, o: 0.8 },
    { kind: "dot", x: 190, y: 82, r: 0, o: 0.85 },
    { kind: "wave", x: 156, y: 84, r: 24, paper: true, o: 0.6 },
    { kind: "strip", x: 186, y: 40, r: 70, o: 0.9 },
    { kind: "dot", x: 78, y: 12, r: 0, paper: true, o: 0.55 },
    { kind: "tri", x: 122, y: 74, r: -30, paper: true, o: 0.5 },
    { kind: "strip", x: 64, y: 30, r: 15, o: 0.6 },
  ];
  return (
    <svg className="look-ornament look-confetti" viewBox="0 0 200 110" aria-hidden="true">
      {pieces.map((piece, index) => {
        const style = { fill: piece.paper ? "var(--color-paper)" : "currentColor", opacity: piece.o ?? 1 };
        const transform = `translate(${piece.x} ${piece.y}) rotate(${piece.r})`;
        if (piece.kind === "dot") return <circle key={index} r="3.4" transform={transform} style={style} />;
        if (piece.kind === "strip")
          return <rect key={index} x="-5" y="-1.8" width="10" height="3.6" rx="1.6" transform={transform} style={style} />;
        if (piece.kind === "tri") return <path key={index} d="M0 -4 L4 3 L-4 3 Z" transform={transform} style={style} />;
        return (
          <path
            key={index}
            d="M-9 0 q 2.25 -4 4.5 0 t 4.5 0 t 4.5 0 t 4.5 0"
            transform={transform}
            fill="none"
            strokeWidth="2.2"
            strokeLinecap="round"
            style={{ stroke: piece.paper ? "var(--color-paper)" : "currentColor", opacity: piece.o ?? 1 }}
          />
        );
      })}
    </svg>
  );
}

/** Diploma: a laurel branch either side of the class year. */
function Laurel({ mirrored = false }: { mirrored?: boolean }) {
  const leaves = [
    { x: 21.5, y: 18.5, r: -60 },
    { x: 16.5, y: 15.5, r: -48 },
    { x: 12, y: 11.5, r: -36 },
    { x: 8.5, y: 7, r: -22 },
    { x: 18.5, y: 21.5, r: 30 },
    { x: 13, y: 19, r: 42 },
    { x: 8.5, y: 15, r: 54 },
    { x: 5.2, y: 10.5, r: 66 },
  ];
  return (
    <svg
      className="look-ornament look-laurel"
      viewBox="0 0 28 26"
      aria-hidden="true"
      style={mirrored ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M26 24 C 17 22, 9 16, 5 3" fill="none" stroke="currentColor" strokeWidth="0.9" />
      {leaves.map((leaf, index) => (
        <ellipse
          key={index}
          cx={leaf.x}
          cy={leaf.y}
          rx="3.6"
          ry="1.5"
          transform={`rotate(${leaf.r} ${leaf.x} ${leaf.y})`}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
