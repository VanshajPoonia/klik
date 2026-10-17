import { describe, expect, it } from "vitest";
import { homeScreenLabel, homeScreenPlatform } from "./home-screen";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPHONE_INSTAGRAM = `${IPHONE_SAFARI.replace(" Safari/604.1", "")} Instagram 345.0.0.0 (iPhone15,3; iOS 18_5)`;
const PIXEL_CHROME =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const SAMSUNG =
  "Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

describe("homeScreenPlatform", () => {
  it("gives each phone its own steps", () => {
    expect(homeScreenPlatform(IPHONE_SAFARI)).toBe("ios");
    expect(homeScreenPlatform(PIXEL_CHROME)).toBe("android");
    expect(homeScreenPlatform(SAMSUNG)).toBe("samsung");
  });

  it("sends a browser inside Instagram or Facebook to the phone's own browser first", () => {
    expect(homeScreenPlatform(IPHONE_INSTAGRAM)).toBe("in-app");
    expect(homeScreenPlatform(`${PIXEL_CHROME} [FB_IAB/FB4A;FBAV/480.0.0.0;]`)).toBe("in-app");
  });

  it("offers nothing on a computer, but knows an iPad that says it is a Mac", () => {
    expect(homeScreenPlatform(MAC_CHROME)).toBeNull();
    expect(homeScreenPlatform(MAC_CHROME, true)).toBe("ios");
  });
});

describe("homeScreenLabel", () => {
  it("keeps a short name whole", () => {
    expect(homeScreenLabel("Maya's 30th")).toBe("Maya's 30th");
  });

  it("keeps the words that fit under the icon, never half a word", () => {
    expect(homeScreenLabel("Dave and Diane's wedding")).toBe("Dave and Diane's");
    expect(homeScreenLabel("Priya & Rohan's reception")).toBe("Priya & Rohan's");
    expect(homeScreenLabel("  Summer   party  ")).toBe("Summer party");
  });

  it("never ends on a joining word", () => {
    expect(homeScreenLabel("Boda de Ana y Luis Ortega")).toBe("Boda de Ana y Luis");
    expect(homeScreenLabel("Mia & Theo and the family")).toBe("Mia & Theo");
  });

  it("cuts a single long word rather than showing nothing", () => {
    expect(homeScreenLabel("Supercalifragilisticexpialidocious")).toBe("Supercalifragilist");
  });
});
