/**
 * The pieces every Klik email shares.
 *
 * Extracted when the second template arrived rather than left duplicated. The
 * palette is the reason: these five values are the shipped brand tokens from
 * `app/globals.css`, and email cannot read a stylesheet, so they have to be
 * literals here. Two copies of a literal palette is how the activation mail ends
 * up a slightly different yellow from the welcome mail.
 *
 * Each template still writes its own document shell. They are different shapes,
 * and a shared layout that both have to bend around would cost more than the
 * duplication saves.
 */

/** Matches `--color-canvas`. */
export const CANVAS = "#050505";
/** Matches `--color-paper`. */
export const PAPER = "#f3f1e9";
/** Matches `--color-volt`. */
export const VOLT = "#edee00";
/** Matches `--color-muted`. */
export const MUTED = "#8c8a80";
/** Matches `--color-canvas-line`. */
export const LINE = "#232320";

/**
 * Escapes the values that come from a person.
 *
 * A name is user input, it is interpolated into HTML, and the result is rendered
 * by someone else's mail client. `<` and `&` are the two that break the
 * document; quotes matter because an escaped value could land in an attribute in
 * a later revision of a template, and finding out then is worse.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The numbered-step list both templates use.
 *
 * Tables and inline styles rather than anything modern, because Outlook renders
 * mail with Word's engine and ignores most of CSS. The number is a fixed-width
 * cell beside the text, not a list marker, for the same reason.
 */
export function renderStepsHtml(steps: Array<[string, string]>): string {
  return steps
    .map(
      ([title, body], index) => `
          <tr>
            <td style="padding:0 0 18px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td width="34" valign="top" style="padding:0;">
                    <div style="width:26px;height:26px;border-radius:13px;background-color:${VOLT};color:${CANVAS};font:600 13px/26px Helvetica,Arial,sans-serif;text-align:center;">${index + 1}</div>
                  </td>
                  <td valign="top" style="padding:0;">
                    <p style="margin:2px 0 4px 0;font:600 15px/1.4 Helvetica,Arial,sans-serif;color:${PAPER};">${escapeHtml(title)}</p>
                    <p style="margin:0;font:400 14px/1.6 Helvetica,Arial,sans-serif;color:${MUTED};">${escapeHtml(body)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`,
    )
    .join("");
}

/** The same steps as plain text, for the part of the mail that is not HTML. */
export function renderStepsText(steps: Array<[string, string]>): string[] {
  return steps.flatMap(([title, body], index) => [`${index + 1}. ${title}`, `   ${body}`, ""]);
}
