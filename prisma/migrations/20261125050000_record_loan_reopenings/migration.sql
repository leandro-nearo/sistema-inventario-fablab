BEGIN;

CREATE TABLE "LoanReopening" (
    "id" SERIAL NOT NULL,
    "loanId" INTEGER NOT NULL,
    "actorId" INTEGER NOT NULL,
    "previousReturnedAt" TIMESTAMP(3) NOT NULL,
    "previousReturnedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanReopening_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LoanReopening_loanId_fkey" FOREIGN KEY ("loanId")
        REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "LoanReopening_loanId_createdAt_id_idx"
    ON "LoanReopening"("loanId", "createdAt", "id");

COMMIT;
