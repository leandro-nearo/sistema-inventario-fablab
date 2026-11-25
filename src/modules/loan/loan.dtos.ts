import type { Pagination } from "@src/shared/validation/fields.js";

export type LoanDTO = {
    id: number;
    clientId: number;
    itemId: number;
    loanDate: Date;
    dueDate: Date;
    loanQuantity: number;
    returnDate: Date | null;
    cancelledAt: Date | null;
    createdById: number | null;
    returnedById: number | null;
    cancelledById: number | null;
    createdAt: Date;
    updatedAt: Date;
};

export type LoanListEntryDTO = LoanDTO & {
    client?: { name: string };
    item?: { name: string };
};

export type LoanCreationResult = { loan: LoanDTO; created: boolean };

export type LoanListOptions = Pagination & {
    status: "all" | "active" | "returned" | "cancelled" | "overdue";
    itemId?: number;
    includeClient?: boolean;
    includeItem?: boolean;
    order?: "recent" | "due";
};

export type CreateLoanDTO = {
    clientId: number;
    itemId: number;
    loanDate: string;
    dueDate: string;
    loanQuantity: number;
    returnDate?: string | null;
};

export type UpdateLoanDTO = {
    loanDate?: string;
    dueDate?: string;
    returnDate?: string | null;
};

export type RenewLoanDTO = { expectedUpdatedAt: string; dueDate: string };
