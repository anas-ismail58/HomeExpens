import { z } from 'zod';

/** Digits, spaces, + ( ) - only; Arabic-Indic digits are converted on the device before sending. */
export const phone = z.string().trim().max(30).regex(/^\+?[0-9 ()-]{3,30}$/, 'Enter a valid phone number');

export const teacherSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: phone.nullable().optional(),
  subject: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const teacherUpdateSchema = teacherSchema.partial().refine((value) => Object.keys(value).length > 0, 'Nothing to update');

/** On a lesson / fee: pick an existing teacher or add a new one inline. */
export const teacherRefSchema = {
  teacherId: z.string().uuid().nullable().optional(),
  newTeacher: teacherSchema.pick({ name: true, phone: true }).optional(),
};

export type TeacherInput = z.infer<typeof teacherSchema>;
export type TeacherRef = { teacherId?: string | null; newTeacher?: { name: string; phone?: string | null } };
