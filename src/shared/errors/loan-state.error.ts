export class RelatedResourceNotFoundError extends Error {
    constructor(readonly resource: "client" | "item") {
        super(`${resource} not found`);
        this.name = "RelatedResourceNotFoundError";
    }
}

export class LoanCancelledError extends Error {
    constructor() {
        super("Loan is cancelled");
        this.name = "LoanCancelledError";
    }
}

export class LoanCreationKeyConflictError extends Error {
    constructor() {
        super("Loan creation key already has a different request");
        this.name = "LoanCreationKeyConflictError";
    }
}

export class LoanDateOrderError extends Error {
    constructor(readonly field: "dueDate" | "returnDate") {
        super(`${field} precedes loanDate`);
        this.name = "LoanDateOrderError";
    }
}
