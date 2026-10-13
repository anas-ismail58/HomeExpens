import { randomBytes } from 'node:crypto';
import { prisma } from '../config/prisma';
import { BUILTIN_SUBJECTS } from '../constants/subjects';
import { AppError } from '../utils/AppError';
import { assertCan, can, type Actor } from './access.service';

/**
 * The family's list of lesson subjects. Created on first use from the built-in subjects plus every
 * subject the family already typed into lessons, fees or teachers, so existing lessons keep their subject.
 */
export async function ensureSubjects(familyId: string) {
  if (await prisma.subject.count({ where: { familyId } })) return;
  const [expenses, fees, teachers] = await Promise.all([
    prisma.expense.findMany({ where: { familyId, subject: { not: null } }, select: { subject: true }, distinct: ['subject'] }),
    prisma.recurringExpense.findMany({ where: { familyId, subject: { not: null } }, select: { subject: true }, distinct: ['subject'] }),
    prisma.teacher.findMany({ where: { familyId, subject: { not: null } }, select: { subject: true }, distinct: ['subject'] }),
  ]);
  const builtin = Object.keys(BUILTIN_SUBJECTS);
  const typed = [...new Set([...expenses, ...fees, ...teachers].map((r) => r.subject!.trim()).filter((s) => s && !builtin.includes(s)))];
  await prisma.subject.createMany({
    data: [
      ...builtin.map((key, index) => ({ familyId, key, name: null, sortOrder: index })),
      ...typed.map((key, index) => ({ familyId, key, name: key, sortOrder: builtin.length + index })),
    ],
    skipDuplicates: true,
  });
}

function dto(row: { id: string; key: string; name: string | null; isActive: boolean }) {
  return { id: row.id, key: row.key, name: row.name, builtin: row.key in BUILTIN_SUBJECTS, isActive: row.isActive };
}

/** Every subject, including removed ones (old lessons still show their name). The app offers active ones. */
export async function listSubjects(actor: Actor) {
  if (!can(actor, 'SERVICE_LESSONS')) return [];
  await ensureSubjects(actor.familyId);
  const rows = await prisma.subject.findMany({ where: { familyId: actor.familyId }, orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] });
  return rows.map(dto);
}

function assertManage(actor: Actor) {
  assertCan(actor, 'SERVICE_LESSONS');
  assertCan(actor, 'ADD_EXPENSE');
}

async function ownSubject(actor: Actor, id: string) {
  const row = await prisma.subject.findFirst({ where: { id, familyId: actor.familyId } });
  if (!row) throw AppError.notFound('Subject not found');
  return row;
}

async function assertNameFree(familyId: string, name: string, exceptId?: string) {
  const rows = await prisma.subject.findMany({ where: { familyId, isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { key: true, name: true } });
  const taken = rows.some((r) => (r.name ?? '').trim().toLowerCase() === name.toLowerCase() || Object.values(BUILTIN_SUBJECTS[r.key] ?? {}).some((n) => !r.name && n.toLowerCase() === name.toLowerCase()));
  if (taken) throw AppError.conflict('A subject with this name already exists');
}

export async function createSubject(actor: Actor, input: { name: string }) {
  assertManage(actor);
  await ensureSubjects(actor.familyId);
  await assertNameFree(actor.familyId, input.name);
  const count = await prisma.subject.count({ where: { familyId: actor.familyId } });
  const row = await prisma.subject.create({ data: { familyId: actor.familyId, key: `s_${randomBytes(5).toString('hex')}`, name: input.name, sortOrder: count } });
  return dto(row);
}

/** Renaming keeps the key, so every lesson with this subject shows the new name. */
export async function updateSubject(actor: Actor, id: string, input: { name?: string; isActive?: boolean }) {
  assertManage(actor);
  const row = await ownSubject(actor, id);
  if (input.name) await assertNameFree(actor.familyId, input.name, id);
  const updated = await prisma.subject.update({ where: { id: row.id }, data: { name: input.name, isActive: input.isActive } });
  return dto(updated);
}

/** Removed from the list for new lessons; lessons that already have it keep showing it. */
export async function deleteSubject(actor: Actor, id: string) {
  assertCan(actor, 'SERVICE_LESSONS');
  assertCan(actor, 'DELETE_EXPENSE');
  const row = await ownSubject(actor, id);
  await prisma.subject.update({ where: { id: row.id }, data: { isActive: false } });
}

/** A lesson's subject must be one of the family's subjects (chosen from the list, not typed). */
export async function assertSubject(familyId: string, key: string | null | undefined) {
  if (!key) return;
  await ensureSubjects(familyId);
  const row = await prisma.subject.findFirst({ where: { familyId, key, isActive: true }, select: { id: true } });
  if (!row) throw AppError.validation([{ field: 'subject', message: 'Choose a subject from the list' }]);
}

/** The subject's name in each language (the family's name when renamed or added). */
export async function subjectNames(familyId: string, key: string) {
  const row = await prisma.subject.findFirst({ where: { familyId, key }, select: { name: true } });
  if (row?.name) return { ar: row.name, en: row.name };
  return BUILTIN_SUBJECTS[key] ?? { ar: key, en: key };
}
