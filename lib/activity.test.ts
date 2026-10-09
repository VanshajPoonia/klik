import { describe, expect, it } from "vitest";
import { describeActivity } from "./activity";

const line = (action: string, detail: string | null = null, target: string | null = null) =>
  describeActivity({ action, detail }, target);

describe("describeActivity", () => {
  it("reads bulk changes as sentences, with the count", () => {
    expect(line("media.bulk", "delete on 3 items.")).toBe("deleted 3 photos and videos");
    expect(line("media.bulk", "approve on 1 items.")).toBe("approved 1 photo or video");
    expect(line("media.bulk", "visibility to private on 2 items.")).toBe("hid 2 photos and videos");
    expect(line("media.bulk", "visibility to gallery on 2 items.")).toBe("showed 2 photos and videos in the gallery");
    expect(line("media.bulk", "something new")).toBe("changed several photos and videos");
  });

  it("names the person a team change was about", () => {
    expect(line("team.changed", "Added as moderator.", "Ana")).toBe("added Ana as moderator");
    expect(line("team.changed", "Role changed to contributor.", "Ana")).toBe("made Ana a contributor");
    expect(line("team.changed", "Removed.", "Ana")).toBe("removed Ana from the team");
    expect(line("team.changed", "Invited a new address as manager.")).toBe("invited someone new as manager");
  });

  it("tells a decline from a withdrawal", () => {
    expect(line("event.transfer_withdrawn", "Declined by the recipient.")).toBe("declined the offer of the event");
    expect(line("event.transfer_withdrawn", "Withdrawn by the owner.")).toBe("withdrew the offer of the event");
  });

  it("says what happened to a comment, never what it said", () => {
    expect(line("comment.hidden", "Hidden by the host.")).toBe("hid a comment");
    expect(line("comment.shown", "Shown again by the host.")).toBe("showed a hidden comment again");
    expect(line("comment.shown", "Kept by the host.")).toBe("kept a reported comment up");
  });

  it("names the kiosk that was set up or switched off", () => {
    expect(line("kiosk.created", "Entrance")).toBe("set up a kiosk, Entrance");
    expect(line("kiosk.revoked", "")).toBe("switched off a kiosk");
  });

  it("never passes an unknown action's detail through", () => {
    expect(line("plan.granted", "Comped. Internal reason.")).toBe("made a change");
  });
});
