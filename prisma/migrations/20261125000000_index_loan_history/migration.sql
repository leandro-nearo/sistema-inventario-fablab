BEGIN;

CREATE INDEX "Loan_loanDate_id_idx" ON "Loan"("loanDate", "id");
CREATE INDEX "Loan_clientId_loanDate_id_idx" ON "Loan"("clientId", "loanDate", "id");
DROP INDEX "Loan_clientId_idx";

COMMIT;
