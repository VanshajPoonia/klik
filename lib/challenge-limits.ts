/**
 * GRW-3: the limits and starter prompts for photo challenges, apart from
 * lib/challenges.ts so the dashboard can use them without the database.
 */

export const MAX_CHALLENGES = 12;
export const MAX_PROMPT_LENGTH = 80;
export const LEADERBOARD_SIZE = 5;

/** Offered to a host with room on their list. Theirs to take, edit or ignore. */
export const SUGGESTED_PROMPTS = [
  "A photo with someone you just met",
  "The best dance move of the night",
  "A selfie with the hosts",
  "The best dressed table",
  "Something that made you laugh",
  "The view from your seat",
];
