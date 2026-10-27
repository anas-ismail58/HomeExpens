-- Paid recurring fees were recorded on their cycle's due date instead of the day they were paid, so
-- money paid in one month counted in the next. Move those expenses to the (local) day they were paid.
UPDATE "expenses" e
SET "date" = (r."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE p."timezone")::date,
    "occurredAt" = r."paidAt"
FROM "payment_records" r
JOIN "payments" p ON p."id" = r."paymentId"
WHERE r."expenseId" = e."id"
  AND e."recurringExpenseId" IS NOT NULL
  AND e."date" <> (r."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE p."timezone")::date;
