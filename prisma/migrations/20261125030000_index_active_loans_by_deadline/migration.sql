CREATE INDEX CONCURRENTLY "Loan_active_dueDate_id_idx"
    ON "Loan"("dueDate", "id")
    WHERE "returnDate" IS NULL AND "cancelledAt" IS NULL;
