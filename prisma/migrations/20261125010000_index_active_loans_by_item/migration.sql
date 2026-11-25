CREATE INDEX CONCURRENTLY "Loan_active_itemId_loanDate_id_idx"
    ON "Loan"("itemId", "loanDate", "id")
    WHERE "returnDate" IS NULL AND "cancelledAt" IS NULL;
