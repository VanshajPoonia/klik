import { isVisionConfigured } from "./ai/workers-ai";
import { isReplicateConfigured } from "./ai/replicate";
import { isStreamConfigured } from "./stream";
import { isPrintsAvailable } from "./prints";

/**
 * The providers that only touch personal information once their feature is
 * switched on (each by its own key). The Privacy Policy describes all of them
 * and says, from this list, which are in use today, so turning one on never
 * changes the policy's words, only that marker. Adding a provider means a
 * line here and a line in the policy's own text.
 */
export interface OptionalProcessor {
  name: string;
  job: string;
  active: boolean;
}

export function optionalProcessors(): OptionalProcessor[] {
  return [
    {
      name: "Cloudflare Workers AI",
      job: "describes each photo in one sentence and a few scene words, so it can be searched and grouped, and checks it for nudity, gore or hate symbols. It is not asked who anyone is, and keeps nothing once it has answered.",
      active: isVisionConfigured(),
    },
    {
      name: "Cloudflare Stream",
      job: "turns videos into streams that play smoothly on a phone. Its copy is deleted when the video is.",
      active: isStreamConfigured(),
    },
    {
      name: "Replicate",
      job: "sharpens and enlarges a photo when the organizer asks it to. It receives that one photo and deletes it within an hour.",
      active: isReplicateConfigured(),
    },
    {
      name: "Prodigi",
      job: "prints and posts the prints a guest orders. It receives the photos ordered and the name and address to ship to.",
      active: isPrintsAvailable(),
    },
    {
      name: "Sentry",
      job: "records errors so we can fix them: what failed and where in our code. Never a photo, a name or an email address.",
      active: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
    },
  ];
}
