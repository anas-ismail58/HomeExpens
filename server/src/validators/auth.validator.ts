import { z } from 'zod';

const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());

export const registerSchema = z.object({
  email,
  password: z.string().min(10).max(128),
  name: z.string().trim().min(2).max(100),
  familyName: z.string().trim().min(2).max(100),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;