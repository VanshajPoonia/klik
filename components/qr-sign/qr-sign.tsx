import type { CSSProperties } from "react";
import type { SignContent } from "@/lib/qr-sign";
import { Confetti, DecoFan, Laurel, Sprig } from "@/components/guest/look-hero";
import { KlikMark } from "./klik-mark";

/**
 * QR-5: one printable QR sign, in a gallery look.
 *
 * Every size in it is a share of the sign's own width or height (container
 * units, `.qs` in app/globals.css), so the same markup is the preview on the
 * sign page and the sheet that comes out of the printer, at any paper size.
 * Type and ornament are the look's own (components/guest/look-hero.tsx);
 * colour is the sign's palette, held to what a printer and a phone camera need.
 */
export function QrSign({ content }: { content: SignContent }) {
  const { look, palette } = content;
  const style = {
    "--qs-bg": palette.background,
    "--qs-ink": palette.ink,
    "--qs-muted": palette.muted,
    "--qs-accent": palette.accent,
    "--qs-on-accent": palette.onAccent,
    "--qs-card": palette.qrCard,
    "--qs-title": `${content.titleSize}cqw`,
    // The look's ornaments draw their second colour in the gallery's paper.
    "--color-paper": palette.ink,
  } as CSSProperties;

  return (
    <div className="qs" data-look={look} data-light={palette.light ? "" : undefined} style={style} lang={content.language}>
      {(look === "black-tie" || look === "white-lace" || look === "diploma") && <span className="qs-frame" aria-hidden="true" />}
      {look === "party" && (
        <>
          <span className="qs-confetti qs-confetti-top">
            <Confetti />
          </span>
          <span className="qs-confetti qs-confetti-bottom">
            <Confetti />
          </span>
        </>
      )}
      {look === "modern" && <span className="qs-band" aria-hidden="true" />}

      <div className="qs-body">
        <header className="qs-head">
          <Heading content={content} />
        </header>

        <div className="qs-main">
          <p className="qs-cta">
            <span>{content.headline}</span>
          </p>
          <div className="qs-code">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URI, drawn here, printed as vectors */}
            <img src={content.qrSrc} alt="" />
          </div>
          {content.steps ? (
            <ol className="qs-steps">
              {content.steps.map((step, index) => (
                <li key={index}>
                  <span className="qs-step-n">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="qs-noapp">{content.noApp}</p>
          )}
        </div>

        <footer className="qs-foot">
          {content.address && (
            <p className="qs-address">
              <span>{content.orVisit}</span> {content.address}
            </p>
          )}
          {content.showLogo && look !== "plain" && (
            <span className="qs-lockup">
              <KlikMark className="qs-mark" />
              klik
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}

function Heading({ content }: { content: SignContent }) {
  const { look, names, title } = content;
  const date = content.date ? <p className="qs-date">{content.date}</p> : null;
  const message = content.message ? <p className="qs-message">{content.message}</p> : null;

  if (look === "black-tie") {
    return (
      <>
        <span className="qs-orn qs-fan">
          <DecoFan />
        </span>
        <p className="qs-title">
          {names ? (
            <>
              {names[0]} <span className="qs-amp">&amp;</span> {names[1]}
            </>
          ) : (
            title
          )}
        </p>
        {date}
        {message}
      </>
    );
  }

  if (look === "white-lace") {
    return (
      <>
        <p className="qs-title">
          {names ? (
            <>
              {names[0]} <span className="qs-amp">&amp;</span> {names[1]}
            </>
          ) : (
            title
          )}
        </p>
        <span className="qs-orn qs-sprig">
          <Sprig />
        </span>
        {date}
        {message}
      </>
    );
  }

  if (look === "party") {
    return (
      <>
        <div className="qs-party">
          {content.age !== null && (
            <span className="qs-age" aria-hidden="true">
              {content.age}
            </span>
          )}
          <div className="qs-party-words">
            <p className="qs-title">{title}</p>
            {date}
          </div>
        </div>
        {message}
      </>
    );
  }

  if (look === "diploma") {
    return (
      <>
        <p className="qs-title">{title}</p>
        {content.classLine && (
          <p className="qs-class">
            <Laurel />
            <span>{content.classLine}</span>
            <Laurel mirrored />
          </p>
        )}
        {content.school && <p className="qs-school">{content.school}</p>}
        {date}
        {message}
      </>
    );
  }

  if (look === "modern") {
    return (
      <>
        <p className="qs-title">{title}</p>
        <span className="qs-rule" aria-hidden="true" />
        {date}
        {message}
      </>
    );
  }

  return (
    <>
      {content.showLogo && (
        <span className="qs-lockup qs-lockup-hero">
          <KlikMark className="qs-mark" />
          klik
        </span>
      )}
      <p className="qs-title">{title}</p>
      {date}
      {message}
    </>
  );
}
