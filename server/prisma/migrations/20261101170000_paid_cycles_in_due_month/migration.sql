-- A paid payment cycle counts in its due month: expenses recorded from paid cycles move to their cycle's due date
-- when they were paid in another month.
UPDATE "expenses" AS e
SET "date" = r."dueDate"
FROM "payment_records" AS r
WHERE r."expenseId" = e."id"
  AND date_trunc('month', e."date") <> date_trunc('month', r."dueDate");
