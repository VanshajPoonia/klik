import { z } from "zod";
import { TEMPLATE_FIELD_LIMITS, TEMPLATE_KEYS } from "./gallery-templates";

/**
 * TPL-1: what a request may say about a gallery's look. Strict, so a field the
 * picker does not know about is refused rather than stored and later shown to
 * guests. What each look actually keeps is decided by `fieldsForTemplate`,
 * after this, so a wedding's names do not linger on a birthday.
 */
export const templateFieldsSchema = z
  .object({
    names: z.tuple([z.string().max(TEMPLATE_FIELD_LIMITS.name), z.string().max(TEMPLATE_FIELD_LIMITS.name)]).optional(),
    name: z.string().max(TEMPLATE_FIELD_LIMITS.name).optional(),
    // A cleared age field arrives as null and means "no age".
    age: z
      .number()
      .int()
      .min(1)
      .max(129)
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    classOf: z.string().max(TEMPLATE_FIELD_LIMITS.classOf).optional(),
    school: z.string().max(TEMPLATE_FIELD_LIMITS.school).optional(),
    headline: z.string().max(TEMPLATE_FIELD_LIMITS.headline).optional(),
    message: z.string().max(TEMPLATE_FIELD_LIMITS.message).optional(),
    showDate: z.boolean().optional(),
  })
  .strict();

/** A look's key, or (for a tab left open since 2026-10-16) a colourway's. */
export const templateChoiceSchema = z.string().min(1).max(40);
export const lookKeySchema = z.enum(TEMPLATE_KEYS);
