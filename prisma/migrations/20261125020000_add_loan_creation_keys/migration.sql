BEGIN;

CREATE TABLE "LoanCreationKey" (
    "userId" INTEGER NOT NULL,
    "key" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "loanId" INTEGER NOT NULL,

    CONSTRAINT "LoanCreationKey_pkey" PRIMARY KEY ("userId", "key"),
    CONSTRAINT "LoanCreationKey_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LoanCreationKey_loanId_fkey" FOREIGN KEY ("loanId")
        REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LoanCreationKey_loanId_key" ON "LoanCreationKey"("loanId");

COMMIT;
