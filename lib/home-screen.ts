/**
 * A gallery on a guest's home screen: one tap back to everyone's photos.
 *
 * **It opens in the phone's own browser, on purpose.** The manifest says
 * `display: "browser"`, so the icon is a shortcut into Safari or Chrome rather
 * than an app window. An iPhone gives a home-screen app its own storage,
 * separate from Safari's: the guest would have to join the gallery again,
 * and the photos still waiting to upload from Safari would not be there. In
 * the browser, their pass and their upload queue are the ones they already
 * have, so the icon only ever saves them a search for the link.
 */

/** What the gallery's start address carries, so a visit from the icon is known. */
export const FROM_HOME_SCREEN = "home";

/** How a phone adds a page to its home screen, or null on a computer. */
export type HomeScreenPlatform = "ios" | "android" | "samsung" | "in-app";

/**
 * Which steps to show. A browser inside Instagram or Facebook cannot add to
 * the home screen at all, so it is told to open the page in the phone's own
 * browser first. An iPad says it is a Mac, and gives itself away by touch.
 */
export function homeScreenPlatform(userAgent: string, touchMac = false): HomeScreenPlatform | null {
  if (/FBAN|FBAV|FB_IAB|Instagram|Snapchat|TikTok|musical_ly|LinkedInApp|\bLine\/|Pinterest/i.test(userAgent)) return "in-app";
  if (/iPhone|iPad|iPod/.test(userAgent) || touchMac) return "ios";
  if (/SamsungBrowser/.test(userAgent)) return "samsung";
  if (/Android/.test(userAgent)) return "android";
  return null;
}

/** Words a label must not end on: "Dave &" says less than "Dave". */
const JOINERS = new Set(["&", "+", "-", "and", "y", "e", "et", "und", "of", "the"]);

/**
 * The label under the icon. Phones show twelve to fourteen characters and
 * trail off after that, so a long name keeps the whole words up to a little
 * past it (the phone's own "…" is better than a name cut to its first word),
 * and never ends on a joining word.
 */
export function homeScreenLabel(name: string, max = 18): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  const words: string[] = [];
  for (const word of trimmed.split(" ")) {
    if ([...words, word].join(" ").length > max) break;
    words.push(word);
  }
  while (words.length > 1 && JOINERS.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.join(" ") || trimmed.slice(0, max);
}
