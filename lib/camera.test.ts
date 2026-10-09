import { describe, expect, it } from "vitest";
import { cameraFailure, levelAngle, wallClock } from "./camera";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36";
const INSTAGRAM = `${IPHONE} Instagram 350.0.0.0`;
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36";

describe("wallClock", () => {
  it("is the local wall time in the shape EXIF and the server use", () => {
    expect(wallClock(new Date(2026, 6, 4, 9, 5, 7))).toBe("2026-07-04T09:05:07");
  });
});

describe("levelAngle", () => {
  const near = (value: number, expected: number) => expect(Math.abs(value - expected)).toBeLessThan(0.01);

  it("is zero for a phone held upright and straight", () => {
    const level = levelAngle(90, 0);
    near(level.degrees, 0);
    expect(level.flat).toBe(false);
  });

  it("turns the line against a phone turned clockwise, the way the world turns in the picture", () => {
    // Upright and turned 10 degrees clockwise: the browser reports this near
    // gimbal lock as gamma 90 and beta 90 minus the turn.
    near(levelAngle(80, 90).degrees, -10);
    // A small clockwise tilt from a slightly reclined phone.
    expect(levelAngle(70, 5).degrees).toBeLessThan(0);
    expect(levelAngle(70, -5).degrees).toBeGreaterThan(0);
  });

  it("accounts for a phone turned on its side with the page following it", () => {
    // Turned a quarter counter-clockwise and held level: the world's up runs
    // along the phone's right edge (gamma -90), which is the page's up.
    near(levelAngle(0, -90, 90).degrees, 0);
    // And the same turn without the page following would read as a quarter.
    near(levelAngle(0, -90, 0).degrees, 90);
  });

  it("calls a phone facing the floor flat", () => {
    expect(levelAngle(2, 3).flat).toBe(true);
  });
});

describe("cameraFailure", () => {
  const blocked = { name: "NotAllowedError" };

  it("tells each platform where the switch is", () => {
    expect(cameraFailure(blocked, IPHONE).help).toContain("Website Settings");
    expect(cameraFailure(blocked, ANDROID).help).toContain("Permissions");
    expect(cameraFailure(blocked, DESKTOP).help).toContain("address bar");
  });

  it("sends someone in an app's own browser out to a real one", () => {
    expect(cameraFailure(blocked, INSTAGRAM).message).toContain("built-in browser");
    expect(cameraFailure({ name: "unsupported" }, INSTAGRAM).help).toContain("Safari or Chrome");
  });

  it("names a busy camera and a missing one", () => {
    expect(cameraFailure({ name: "NotReadableError" }, ANDROID).message).toContain("Another app");
    expect(cameraFailure({ name: "NotFoundError" }, DESKTOP).message).toContain("No camera");
    expect(cameraFailure(new Error("odd"), DESKTOP).message).toBe("The camera didn't start.");
  });
});
