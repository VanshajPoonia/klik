import { describe, expect, it } from "vitest";
import { eventLiveEmail } from "./event-live";
import { activationEmail } from "./activation";

const base = {
  name: "Maya",
  eventName: "Ana & Leo <wedding>",
  planName: "Klik Premium",
  eventUrl: "https://example.test/dashboard/events/evt_1",
  appUrl: "https://example.test",
};

describe("eventLiveEmail", () => {
  const message = eventLiveEmail(base);

  it("links to the event's own page, where the QR code is", () => {
    expect(message.html).toContain(base.eventUrl);
    expect(message.text).toContain(base.eventUrl);
  });

  it("names the event and its plan", () => {
    expect(message.subject).toContain("Ana & Leo <wedding>");
    expect(message.text).toContain("Klik Premium");
  });

  it("escapes an event name, which is organizer input", () => {
    expect(message.html).not.toContain("<wedding>");
    expect(message.html).toContain("&lt;wedding&gt;");
  });
});

describe("activationEmail when a draft went live with the grant", () => {
  const message = activationEmail({
    name: "Maya",
    planName: "Klik Event",
    username: null,
    appUrl: "https://example.test",
    liveEventName: "Maya's 30th",
  });

  it("names the live event instead of telling them to create one", () => {
    for (const part of [message.html, message.text]) {
      expect(part).not.toContain("Create your event");
      expect(part).toContain("Maya");
      expect(part).toContain("is live");
    }
  });
});
