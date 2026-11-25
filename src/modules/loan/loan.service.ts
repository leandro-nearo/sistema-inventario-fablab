import { createHash } from "node:crypto";
import type {
    CreateLoanDTO,
    LoanCreationResult,
    LoanDTO,
    LoanListEntryDTO,
    LoanListOptions,
} from "@modules/loan/loan.dtos.js";
import { MESSAGES } from "@src/constants/messages.js";
import { AppError } from "@src/shared/errors/app.error.js";
import { InsufficientStockError } from "@src/shared/errors/insufficient-stock.error.js";
import {
    LoanCancelledError,
    LoanCreationKeyConflictError,
    LoanDateOrderError,
    LoanRenewalError,
    LoanVersionConflictError,
    RelatedResourceNotFoundError,
} from "@src/shared/errors/loan-state.error.js";
import type { Pagination } from "@src/shared/validation/fields.js";
import { CreateLoanValidator } from "./input-validation/create-loan.validator.js";
import {
    type LoanCreateData,
    type LoanRenewalData,
    type LoanRepository,
    type LoanUpdateData,
    PrismaLoanRepository,
} from "./repositories/loan.repository.js";

function loanNotFound() {
    return new AppError(MESSAGES.LOAN.NOT_FOUND.BY_ID, 404, "LOAN_NOT_FOUND");
}

const renewalErrors = {
    returned: ["Um empréstimo devolvido não pode ser renovado.", 409, "LOAN_RETURNED"],
    date: [
        "O novo prazo deve estar no futuro e ser posterior ao prazo atual.",
        400,
        "INVALID_LOAN_RENEWAL_DATE",
    ],
} as const;

export class LoanService {
    constructor(private readonly loanRepository: LoanRepository = new PrismaLoanRepository()) {}

    async create(data: CreateLoanDTO, actorId: number, key?: string): Promise<LoanCreationResult> {
        CreateLoanValidator.validate(data);

        const loan: LoanCreateData = {
            loanDate: new Date(data.loanDate),
            dueDate: new Date(data.dueDate),
            returnDate: data.returnDate ? new Date(data.returnDate) : null,
            loanQuantity: data.loanQuantity,
            clientId: data.clientId,
            itemId: data.itemId,
            createdById: actorId,
            returnedById: data.returnDate ? actorId : null,
        };
        try {
            const request = key
                ? {
                      key,
                      requestHash: createHash("sha256")
                          .update(
                              JSON.stringify([
                                  loan.clientId,
                                  loan.itemId,
                                  loan.loanDate,
                                  loan.dueDate,
                                  loan.loanQuantity,
                                  loan.returnDate,
                              ]),
                          )
                          .digest("hex"),
                  }
                : undefined;
            return await this.loanRepository.createWithStockReservation(loan, request);
        } catch (error) {
            if (error instanceof LoanCreationKeyConflictError) {
                throw new AppError(
                    "A chave de cadastro já foi usada com outros dados.",
                    409,
                    "IDEMPOTENCY_KEY_CONFLICT",
                );
            }
            if (error instanceof InsufficientStockError) {
                throw new AppError(
                    MESSAGES.LOAN.VALIDATION.QUANTITY_TOO_BIG(error.availableQuantity),
                );
            }

            if (error instanceof RelatedResourceNotFoundError) {
                const message =
                    error.resource === "client"
                        ? MESSAGES.CLIENT.NOT_FOUND.BY_ID
                        : MESSAGES.ITEM.NOT_FOUND.BY_ID;
                throw new AppError(message, 404, `${error.resource.toUpperCase()}_NOT_FOUND`);
            }

            throw error;
        }
    }

    async list(options: LoanListOptions): Promise<LoanListEntryDTO[]> {
        return this.loanRepository.list(options);
    }

    async getById(id: number): Promise<LoanDTO> {
        const loan = await this.loanRepository.findById(id);
        if (!loan) throw loanNotFound();
        return loan;
    }

    async listReopenings(id: number, pagination: Pagination) {
        await this.getById(id);
        return this.loanRepository.listReopenings(id, pagination);
    }

    updateById(
        id: number,
        data: LoanUpdateData,
        actorId: number,
        expectedUpdatedAt?: Date,
    ): Promise<LoanDTO> {
        return this.changeById(() =>
            this.loanRepository.updateWithStock(id, data, actorId, expectedUpdatedAt),
        );
    }

    returnById(id: number, actorId: number, expectedUpdatedAt?: Date): Promise<LoanDTO> {
        return this.changeById(() =>
            this.loanRepository.returnWithStock(id, actorId, expectedUpdatedAt),
        );
    }

    renewById(id: number, data: LoanRenewalData): Promise<LoanDTO> {
        return this.changeById(() => this.loanRepository.renewDueDate(id, data));
    }

    private async changeById(change: () => Promise<LoanDTO | null>): Promise<LoanDTO> {
        try {
            const loan = await change();

            if (!loan) throw loanNotFound();

            return loan;
        } catch (error) {
            if (error instanceof InsufficientStockError) {
                throw new AppError(
                    MESSAGES.LOAN.VALIDATION.QUANTITY_TOO_BIG(error.availableQuantity),
                );
            }

            if (error instanceof LoanCancelledError) {
                throw new AppError(
                    "Um empréstimo cancelado não pode ser alterado.",
                    409,
                    "LOAN_CANCELLED",
                );
            }

            if (error instanceof LoanDateOrderError) {
                const message =
                    error.field === "dueDate"
                        ? MESSAGES.LOAN.VALIDATION.DUE_DATE_BEFORE_LOAN
                        : MESSAGES.LOAN.VALIDATION.RETURN_DATE_BEFORE_LOAN;
                throw new AppError(message, 400, "INVALID_LOAN_DATES");
            }

            if (error instanceof LoanRenewalError) {
                const [message, status, code] = renewalErrors[error.reason];
                throw new AppError(message, status, code);
            }

            if (error instanceof LoanVersionConflictError) {
                throw new AppError(
                    "O empréstimo mudou. Consulte o registro e tente novamente.",
                    409,
                    "LOAN_CHANGED",
                );
            }

            throw error;
        }
    }

    async cancelById(id: number, actorId: number, expectedUpdatedAt?: Date): Promise<void> {
        await this.changeById(() =>
            this.loanRepository.cancelWithStock(id, actorId, expectedUpdatedAt),
        );
    }
}

const loanService = new LoanService();

export { loanService };
