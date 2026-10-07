/* eslint-disable no-console */
import { PrismaClient, type OwnerType, type PaymentMethodType, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { provisionFamilyDefaults } from '../src/services/familyDefaults.service';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@family.app';
const DEMO_PASSWORD = 'Demo@12345';

/** Date-only (UTC midnight) relative to the current month. monthOffset 0 = this month. */
function day(monthOffset: number, dayOfMonth: number): Date {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + monthOffset;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  // Never create future-dated transactions in the current month
  const maxDay = monthOffset === 0 ? Math.min(lastDay, now.getUTCDate()) : lastDay;
  return new Date(Date.UTC(y, m, Math.min(dayOfMonth, maxDay)));
}

/** Same as day() but without the "not in the future" cap (for nextOccurrence). */
function dayRaw(monthOffset: number, dayOfMonth: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, dayOfMonth));
}

async function main() {
  console.log('🌱 Seeding...');

  // Idempotent: remove previous demo user (cascades to family and all its data)
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  await prisma.$transaction(
    async (tx) => {
      const user = await tx.user.create({
        data: { email: DEMO_EMAIL, passwordHash, name: 'أحمد العتيبي' },
      });

      const family = await tx.family.create({
        data: { ownerId: user.id, name: 'عائلة العتيبي', currency: 'EGP', language: 'ar' },
      });
      await tx.user.update({ where: { id: user.id }, data: { familyId: family.id, role: 'FATHER' } });

      await provisionFamilyDefaults(tx, family.id);

      // ── Members ──
      const husband = await tx.familyMember.create({
        data: { familyId: family.id, name: 'أحمد', type: 'HUSBAND', dateOfBirth: new Date('1988-04-12') },
      });
      const wife = await tx.familyMember.create({
        data: { familyId: family.id, name: 'سارة', type: 'WIFE', dateOfBirth: new Date('1991-09-03') },
      });
      const omar = await tx.familyMember.create({
        data: {
          familyId: family.id, name: 'عمر', type: 'CHILD', dateOfBirth: new Date('2015-02-20'),
          school: 'مدارس الرواد', grade: 'الخامس الابتدائي',
        },
      });
      const lina = await tx.familyMember.create({
        data: {
          familyId: family.id, name: 'لينا', type: 'CHILD', dateOfBirth: new Date('2019-11-08'),
          school: 'روضة البراعم', grade: 'التمهيدي',
        },
      });

      // ── Lookups ──
      const categories = await tx.category.findMany({
        where: { familyId: family.id },
        include: { subcategories: true },
      });
      const cat = (key: string) => {
        const c = categories.find((x) => x.key === key);
        if (!c) throw new Error(`Missing category ${key}`);
        return c;
      };
      const sub = (catKey: string, subKey: string) => {
        const s = cat(catKey).subcategories.find((x) => x.key === subKey);
        if (!s) throw new Error(`Missing subcategory ${catKey}/${subKey}`);
        return s;
      };
      const methods = await tx.paymentMethod.findMany({ where: { familyId: family.id } });
      const pm = (type: PaymentMethodType) => methods.find((m) => m.type === type)!.id;

      const owners: Record<string, { ownerType: OwnerType; memberId: string | null }> = {
        house: { ownerType: 'HOUSEHOLD', memberId: null },
        husband: { ownerType: 'HUSBAND', memberId: husband.id },
        wife: { ownerType: 'WIFE', memberId: wife.id },
        omar: { ownerType: 'CHILD', memberId: omar.id },
        lina: { ownerType: 'CHILD', memberId: lina.id },
      };

      // ── Recurring rent ──
      const rent = await tx.recurringExpense.create({
        data: {
          familyId: family.id, ownerType: 'HOUSEHOLD',
          categoryId: cat('household').id, subcategoryId: sub('household', 'rent').id,
          paymentMethodId: pm('BANK_ACCOUNT'), amount: '3500', description: 'إيجار الشقة',
          frequency: 'MONTHLY', startDate: day(-2, 1), nextOccurrence: dayRaw(1, 1),
        },
      });

      // ── Expenses (template repeated for the last 3 months) ──
      type Row = [owner: keyof typeof owners, catKey: string, subKey: string | null, amount: string, desc: string, dayOfMonth: number, method: PaymentMethodType];
      const template: Row[] = [
        ['house', 'household', 'electricity', '420', 'فاتورة الكهرباء', 5, 'MADA'],
        ['house', 'household', 'water', '95', 'فاتورة المياه', 6, 'MADA'],
        ['house', 'household', 'internet', '299', 'اشتراك الإنترنت', 2, 'CREDIT_CARD'],
        ['house', 'food', 'groceries', '860', 'مشتريات البقالة الأسبوعية', 3, 'MADA'],
        ['house', 'food', 'groceries', '740', 'مشتريات البقالة', 17, 'APPLE_PAY'],
        ['house', 'food', 'restaurants', '310', 'عشاء عائلي', 12, 'APPLE_PAY'],
        ['husband', 'transportation', 'fuel', '240', 'وقود السيارة', 4, 'MADA'],
        ['husband', 'transportation', 'fuel', '230', 'وقود السيارة', 19, 'MADA'],
        ['husband', 'personal', 'clothing', '450', 'ملابس', 14, 'CREDIT_CARD'],
        ['husband', 'entertainment', 'subscriptions', '65', 'اشتراك رياضي', 1, 'CREDIT_CARD'],
        ['wife', 'personal', 'shopping', '520', 'تسوق', 9, 'APPLE_PAY'],
        ['wife', 'personal', 'personal_care', '280', 'عناية شخصية', 16, 'MADA'],
        ['wife', 'health', 'doctor', '350', 'مراجعة طبية', 11, 'MADA'],
        ['omar', 'education', 'books', '180', 'كتب وقرطاسية', 7, 'CASH'],
        ['omar', 'children', 'activities', '400', 'نادي كرة القدم', 10, 'MADA'],
        ['omar', 'children', 'pocket_money', '200', 'المصروف الشهري', 1, 'CASH'],
        ['lina', 'children', 'toys', '160', 'ألعاب', 13, 'APPLE_PAY'],
        ['lina', 'health', 'medicine', '85', 'أدوية', 8, 'MADA'],
        ['lina', 'personal', 'clothing', '240', 'ملابس', 15, 'MADA'],
      ];

      const expenses: Prisma.ExpenseCreateManyInput[] = [];
      for (const offset of [-2, -1, 0]) {
        // Recurring rent occurrence
        expenses.push({
          familyId: family.id, ...owners.house, categoryId: cat('household').id,
          subcategoryId: sub('household', 'rent').id, paymentMethodId: pm('BANK_ACCOUNT'),
          amount: '3500', description: 'إيجار الشقة', date: day(offset, 1),
          isRecurring: true, recurringExpenseId: rent.id,
        });
        for (const [owner, catKey, subKey, amount, description, d, method] of template) {
          // small variation per month so charts aren't flat
          const varied = (Number(amount) * (1 + offset * 0.04)).toFixed(2);
          expenses.push({
            familyId: family.id, ...owners[owner],
            categoryId: cat(catKey).id, subcategoryId: subKey ? sub(catKey, subKey).id : null,
            paymentMethodId: pm(method), amount: varied, description, date: day(offset, d),
          });
        }
      }
      // One-off: school fees for both children two months ago
      expenses.push(
        { familyId: family.id, ...owners.omar, categoryId: cat('education').id, subcategoryId: sub('education', 'school_fees').id, paymentMethodId: pm('BANK_ACCOUNT'), amount: '6500', description: 'رسوم الفصل الدراسي', date: day(-2, 20) },
        { familyId: family.id, ...owners.lina, categoryId: cat('education').id, subcategoryId: sub('education', 'school_fees').id, paymentMethodId: pm('BANK_ACCOUNT'), amount: '4200', description: 'رسوم الروضة', date: day(-2, 20) },
      );
      await tx.expense.createMany({ data: expenses.map((expense) => ({ ...expense, createdById: user.id })) });

      // ── Income ──
      const salary = await tx.recurringIncome.create({
        data: {
          familyId: family.id, memberId: husband.id, amount: '14000', source: 'الراتب',
          frequency: 'MONTHLY', startDate: day(-2, 27), nextOccurrence: dayRaw(0, 27),
        },
      });
      const incomes: Prisma.IncomeCreateManyInput[] = [];
      for (const offset of [-2, -1]) {
        incomes.push(
          { familyId: family.id, memberId: husband.id, amount: '14000', source: 'الراتب', date: day(offset, 27), isRecurring: true, recurringIncomeId: salary.id },
          { familyId: family.id, memberId: wife.id, amount: '6000', source: 'الراتب', date: day(offset, 25) },
        );
      }
      incomes.push({ familyId: family.id, memberId: husband.id, amount: '1500', source: 'عمل حر', description: 'مشروع تصميم', date: day(0, 2) });
      await tx.income.createMany({ data: incomes.map((income) => ({ ...income, createdById: user.id })) });

      // ── Budget for current month ──
      const now = new Date();
      await tx.budget.create({
        data: {
          familyId: family.id, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, totalAmount: '15000',
          items: {
            create: [
              { categoryId: cat('household').id, amount: '4500' },
              { categoryId: cat('food').id, amount: '2500' },
              { categoryId: cat('transportation').id, amount: '1500' },
              { categoryId: cat('education').id, amount: '3000' },
              { categoryId: cat('personal').id, amount: '2000' },
              { categoryId: cat('entertainment').id, amount: '500' },
              { memberId: omar.id, amount: '1200' },
              { memberId: lina.id, amount: '700' },
            ],
          },
        },
      });

      // ── Savings goals ──
      await tx.savingsGoal.create({
        data: {
          familyId: family.id, name: 'صندوق الطوارئ', targetAmount: '100000', targetDate: new Date('2027-12-31'),
          contributions: {
            create: [
              { amount: '30000', date: day(-2, 28), note: 'رصيد افتتاحي' },
              { amount: '2500', date: day(-1, 28) },
              { amount: '2500', date: day(0, 1) },
            ],
          },
        },
      });
      await tx.savingsGoal.create({
        data: {
          familyId: family.id, name: 'إجازة الصيف', targetAmount: '18000', targetDate: new Date('2027-06-30'),
          contributions: { create: [{ amount: '4000', date: day(-1, 28) }] },
        },
      });
    },
    { timeout: 60_000 },
  );

  console.log('✅ Seed complete');
  console.log(`   Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
