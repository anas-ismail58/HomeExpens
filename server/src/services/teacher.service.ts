import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import type { TeacherInput, TeacherRef } from '../validators/teacher.validator';
import { assertCan, can, type Actor } from './access.service';

export const teacherSelect = { id: true, name: true, phone: true, subject: true } as const;

/** Teachers belong to the lessons service. */
export async function listTeachers(actor: Actor) {
  if (!can(actor, 'SERVICE_LESSONS')) return [];
  return prisma.teacher.findMany({
    where: { familyId: actor.familyId, deletedAt: null },
    select: { ...teacherSelect, notes: true },
    orderBy: { name: 'asc' },
  });
}

function assertManage(actor: Actor) {
  assertCan(actor, 'SERVICE_LESSONS');
  assertCan(actor, 'ADD_EXPENSE');
}

export async function createTeacher(actor: Actor, input: TeacherInput) {
  assertManage(actor);
  return prisma.teacher.create({
    data: { familyId: actor.familyId, name: input.name, phone: input.phone ?? null, subject: input.subject ?? null, notes: input.notes ?? null },
    select: { ...teacherSelect, notes: true },
  });
}

async function ownTeacher(actor: Actor, id: string) {
  const teacher = await prisma.teacher.findFirst({ where: { id, familyId: actor.familyId, deletedAt: null } });
  if (!teacher) throw AppError.notFound('Teacher not found');
  return teacher;
}

export async function updateTeacher(actor: Actor, id: string, input: Partial<TeacherInput>) {
  assertManage(actor);
  await ownTeacher(actor, id);
  return prisma.teacher.update({ where: { id }, data: input, select: { ...teacherSelect, notes: true } });
}

/** Hidden from new lessons; past lessons keep the teacher's name and number. */
export async function deleteTeacher(actor: Actor, id: string) {
  assertCan(actor, 'SERVICE_LESSONS');
  assertCan(actor, 'DELETE_EXPENSE');
  await ownTeacher(actor, id);
  await prisma.teacher.update({ where: { id }, data: { deletedAt: new Date() } });
}

/** Resolves a lesson's teacher: an existing one from this family, a new one created inline, or none. */
export async function resolveTeacher(actor: Actor, ref: TeacherRef) {
  if (ref.newTeacher) {
    const created = await prisma.teacher.create({ data: { familyId: actor.familyId, name: ref.newTeacher.name, phone: ref.newTeacher.phone ?? null } });
    return created;
  }
  if (ref.teacherId) return ownTeacher(actor, ref.teacherId);
  return null;
}
