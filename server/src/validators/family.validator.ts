import { z } from 'zod';
import { timeZone } from './auth.validator';
import { CURRENCIES } from './payment.validator';

export const familyIdParamSchema = z.object({ id: z.string().uuid() });
export const familyMemberParamSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
export const familyInvitationParamSchema = z.object({ id: z.string().uuid(), invitationId: z.string().uuid() });
export const inviteCodeParamSchema = z.object({ code: z.string().trim().min(6).max(32) });

export const familyUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    currency: z.enum(CURRENCIES).optional(),
    timezone: timeZone.optional(),
    language: z.enum(['ar', 'en']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

export const invitationSchema = z
  .object({
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    role: z.enum(['FATHER', 'MOTHER', 'CHILD']),
    /** CHILD: the child record this login represents; when omitted one is created with the person's name. */
    memberId: z.string().uuid().optional(),
  });

export const roleSchema = z
  .object({ role: z.enum(['FATHER', 'MOTHER', 'CHILD']), memberId: z.string().uuid().optional() });

const permissionKey = z.enum(['VIEW_EXPENSES', 'ADD_EXPENSE', 'EDIT_EXPENSE', 'DELETE_EXPENSE', 'VIEW_PAYMENTS', 'ADD_PAYMENT', 'EDIT_PAYMENT', 'DELETE_PAYMENT', 'VIEW_REPORTS', 'MANAGE_CHILDREN', 'SERVICE_LESSONS', 'SERVICE_RECURRING', 'SERVICE_HOUSEHOLD', 'VIEW_INCOME']);
export const permissionsSchema = z.object({
  permissions: z.record(permissionKey, z.boolean()).refine((value) => Object.keys(value).length > 0, 'Nothing to update'),
});

/** Username ("sara") or email: letters, digits and . _ @ + - only. */
const loginName = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .regex(/^[A-Za-z0-9._@+-]+$/, 'Use letters, numbers and . _ @ + - only')
  .transform((value) => value.toLowerCase());

/** The admin creates a login for a family member directly (no invitation needed). */
export const memberAccountSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    login: loginName,
    password: z.string().min(4).max(200),
    role: z.enum(['FATHER', 'MOTHER', 'CHILD']),
    /** CHILD: the child record this login represents; when omitted one is created with the name. */
    memberId: z.string().uuid().optional(),
  });

export const passwordResetSchema = z.object({ password: z.string().min(4).max(200) });

export type MemberAccountInput = z.infer<typeof memberAccountSchema>;
export type FamilyUpdateInput = z.infer<typeof familyUpdateSchema>;
export type InvitationInput = z.infer<typeof invitationSchema>;
export type RoleInput = z.infer<typeof roleSchema>;
export type PermissionsInput = z.infer<typeof permissionsSchema>;
