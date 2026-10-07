import { z } from 'zod';
import { isValidTimeZone } from '../utils/time';

const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
// Login accepts a plain username (e.g. "admin") as well as an email.
const loginId = z.string().trim().min(1).max(254).transform((value) => value.toLowerCase());
const password = z.string().min(1);
export const timeZone = z.string().trim().min(1).max(64).refine(isValidTimeZone, 'Unknown time zone');
export const inviteCode = z.string().trim().min(6).max(32).transform((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, ''));

/** Register either creates a new family (familyName) or joins one (inviteCode) — exactly one. */
export const registerSchema = z
  .object({
    email,
    password,
    name: z.string().trim().min(2).max(100),
    familyName: z.string().trim().min(2).max(100).optional(),
    inviteCode: inviteCode.optional(),
    timezone: timeZone.optional(),
  })
  .refine((value) => Boolean(value.familyName) !== Boolean(value.inviteCode), {
    message: 'Provide either a family name (new family) or an invitation code (join a family)',
    path: ['familyName'],
  });

export const loginSchema = z.object({
  email: loginId,
  password,
  /** Who is signing in, chosen on the login screen. Checked against the account's role. */
  as: z.enum(['FATHER', 'MEMBER']).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    timezone: timeZone.optional(),
    profileImage: z.string().trim().url().max(2048).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
