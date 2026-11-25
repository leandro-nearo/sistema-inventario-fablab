import type { Loan, Prisma } from "@src/generated/prisma/client.js";
import { prisma } from "@src/lib/prisma.js";
import { InsufficientStockError } from "@src/shared/errors/insufficient-stock.error.js";
import {
    LoanCancelledError,
    LoanCreationKeyConflictError,
    LoanDateOrderError,
    LoanRenewalError,
    LoanVersionConflictError,
    RelatedResourceNotFoundError,
} from "@src/shared/errors/loan-state.error.js";
import type { LoanCreationResult, LoanListEntryDTO, LoanListOptions } from "../loan.dtos.js";

export type LoanCreateData = {
    clientId: number;
    itemId: number;
    loanDate: Date;
    dueDate: Date;
    loanQuantity: number;
    returnDate: Date | null;
    createdById: number;
    returnedById: number | null;
};

export type LoanUpdateData = {
    loanDate?: Date;
    dueDate?: Date;
    returnDate?: Date | null;
};

export type LoanRenewalData = { expectedUpdatedAt: Date; dueDate: Date };

type LoanCreationRequest = { key: string; requestHash: string };

export interface LoanRepository {
    createWithStockReservation(
        data: LoanCreateData,
        request?: LoanCreationRequest,
    ): Promise<LoanCreationResult>;
    list(options: LoanListOptions): Promise<LoanListEntryDTO[]>;
    findById(id: number): Promise<Loan | null>;
    updateWithStock(id: number, data: LoanUpdateData, actorId: number): Promise<Loan | null>;
    returnWithStock(id: number, actorId: number, expectedUpdatedAt?: Date): Promise<Loan | null>;
    renewDueDate(id: number, data: LoanRenewalData): Promise<Loan | null>;
    cancelWithStock(id: number, actorId: number, expectedUpdatedAt?: Date): Promise<Loan | null>;
}

async function findLockedLoan(tx: Prisma.TransactionClient, id: number) {
    const [loan] = await tx.$queryRaw<Loan[]>`
        SELECT * FROM "Loan" WHERE "id" = ${id} FOR UPDATE
    `;
    return loan ?? null;
}

function nextLoanUpdateTime(loan: Loan) {
    // Mantenha a versão distinta quando duas alterações ocorrerem no mesmo milissegundo.
    return new Date(Math.max(Date.now(), loan.updatedAt.getTime() + 1));
}

async function reserveStock(tx: Prisma.TransactionClient, itemId: number, quantity: number) {
    const reserved = await tx.item.updateMany({
        where: { id: itemId, availableQuantity: { gte: quantity } },
        data: { availableQuantity: { decrement: quantity } },
    });
    if (reserved.count === 1) return;

    const item = await tx.item.findUnique({
        where: { id: itemId },
        select: { availableQuantity: true },
    });
    if (!item) throw new RelatedResourceNotFoundError("item");
    throw new InsufficientStockError(item.availableQuantity);
}

export class PrismaLoanRepository implements LoanRepository {
    async createWithStockReservation(
        data: LoanCreateData,
        request?: LoanCreationRequest,
    ): Promise<LoanCreationResult> {
        const creationKey = request && { userId: data.createdById, ...request };
        return prisma.$transaction(
            async (tx: Prisma.TransactionClient) => {
                if (creationKey) {
                    const { userId, key, requestHash } = creationKey;
                    const lock = `loan-create:${userId}:${key}`;
                    // Aguarde outra transação com a mesma chave antes de consultar a reserva.
                    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
                    const existing = await tx.loanCreationKey.findUnique({
                        where: { userId_key: { userId, key } },
                        include: { loan: true },
                    });
                    if (existing) {
                        if (existing.requestHash !== requestHash) {
                            throw new LoanCreationKeyConflictError();
                        }
                        return { loan: existing.loan, created: false };
                    }
                }

                const client = await tx.client.findUnique({
                    where: { id: data.clientId },
                    select: { id: true },
                });
                if (!client) throw new RelatedResourceNotFoundError("client");

                if (data.returnDate === null) {
                    await reserveStock(tx, data.itemId, data.loanQuantity);
                } else {
                    const item = await tx.item.findUnique({
                        where: { id: data.itemId },
                        select: { id: true },
                    });
                    if (!item) throw new RelatedResourceNotFoundError("item");
                }

                const loan = await tx.loan.create({ data });
                if (creationKey) {
                    await tx.loanCreationKey.create({
                        data: { ...creationKey, loanId: loan.id },
                    });
                }
                return { loan, created: true };
            },
            creationKey ? { isolationLevel: "ReadCommitted" } : undefined,
        );
    }

    list({ skip, take, status, itemId, includeClient, includeItem, order }: LoanListOptions) {
        const where: Prisma.LoanWhereInput =
            status === "active"
                ? { returnDate: null, cancelledAt: null }
                : status === "returned"
                  ? { returnDate: { not: null }, cancelledAt: null }
                  : status === "cancelled"
                    ? { cancelledAt: { not: null } }
                    : status === "overdue"
                      ? { returnDate: null, cancelledAt: null, dueDate: { lt: new Date() } }
                      : {};
        if (itemId !== undefined) where.itemId = itemId;

        return prisma.loan.findMany({
            where,
            include: {
                client: includeClient ? { select: { name: true } } : false,
                item: includeItem ? { select: { name: true } } : false,
            },
            orderBy:
                order === "due"
                    ? [{ dueDate: "asc" }, { id: "asc" }]
                    : [{ loanDate: "desc" }, { id: "desc" }],
            skip,
            take,
        });
    }

    findById(id: number) {
        return prisma.loan.findUnique({ where: { id } });
    }

    updateWithStock(id: number, data: LoanUpdateData, actorId: number): Promise<Loan | null> {
        return this.changeWithStock(id, actorId, data);
    }

    returnWithStock(id: number, actorId: number, expectedUpdatedAt?: Date): Promise<Loan | null> {
        return this.changeWithStock(id, actorId, "return", expectedUpdatedAt);
    }

    renewDueDate(
        id: number,
        { expectedUpdatedAt, dueDate }: LoanRenewalData,
    ): Promise<Loan | null> {
        return prisma.$transaction(async (tx) => {
            const existing = await findLockedLoan(tx, id);
            if (!existing) return null;
            if (existing.cancelledAt !== null) throw new LoanCancelledError();
            if (existing.returnDate !== null) throw new LoanRenewalError("returned");
            const currentVersion = existing.updatedAt.getTime();
            const expectedVersion = expectedUpdatedAt.getTime();
            if (currentVersion !== expectedVersion) {
                if (
                    expectedVersion < currentVersion &&
                    dueDate.getTime() === existing.dueDate.getTime()
                ) {
                    return existing;
                }
                throw new LoanVersionConflictError();
            }
            if (dueDate <= existing.dueDate || dueDate.getTime() <= Date.now()) {
                throw new LoanRenewalError("date");
            }

            return tx.loan.update({
                where: { id },
                data: { dueDate, updatedAt: nextLoanUpdateTime(existing) },
            });
        });
    }

    private changeWithStock(
        id: number,
        actorId: number,
        change: LoanUpdateData | "return",
        expectedUpdatedAt?: Date,
    ): Promise<Loan | null> {
        return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const existing = await findLockedLoan(tx, id);

            if (!existing) {
                return null;
            }

            if (existing.cancelledAt !== null) throw new LoanCancelledError();
            if (change === "return" && existing.returnDate !== null) return existing;
            if (expectedUpdatedAt && existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
                throw new LoanVersionConflictError();
            }

            const data = change === "return" ? { returnDate: new Date() } : change;
            const loanDate = data.loanDate ?? existing.loanDate;
            const dueDate = data.dueDate ?? existing.dueDate;
            const returnDate =
                data.returnDate !== undefined ? data.returnDate : existing.returnDate;

            if (dueDate < loanDate) throw new LoanDateOrderError("dueDate");
            if (returnDate !== null && returnDate < loanDate) {
                throw new LoanDateOrderError("returnDate");
            }

            const isBeingReturned =
                existing.returnDate === null &&
                data.returnDate !== undefined &&
                data.returnDate !== null;
            const isBeingReopened = existing.returnDate !== null && data.returnDate === null;

            if (isBeingReturned) {
                await tx.item.update({
                    where: { id: existing.itemId },
                    data: { availableQuantity: { increment: existing.loanQuantity } },
                    select: { id: true },
                });
            }

            if (isBeingReopened) {
                await reserveStock(tx, existing.itemId, existing.loanQuantity);
            }

            return tx.loan.update({
                where: { id },
                data: {
                    ...data,
                    updatedAt: nextLoanUpdateTime(existing),
                    ...(isBeingReturned ? { returnedById: actorId } : {}),
                    ...(isBeingReopened ? { returnedById: null } : {}),
                },
            });
        });
    }

    async cancelWithStock(
        id: number,
        actorId: number,
        expectedUpdatedAt?: Date,
    ): Promise<Loan | null> {
        return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const existing = await findLockedLoan(tx, id);

            if (!existing) {
                return null;
            }

            if (existing.cancelledAt !== null) return existing;
            if (expectedUpdatedAt && existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
                throw new LoanVersionConflictError();
            }

            if (existing.returnDate === null) {
                await tx.item.update({
                    where: { id: existing.itemId },
                    data: { availableQuantity: { increment: existing.loanQuantity } },
                    select: { id: true },
                });
            }

            return tx.loan.update({
                where: { id },
                data: {
                    cancelledAt: new Date(),
                    cancelledById: actorId,
                    updatedAt: nextLoanUpdateTime(existing),
                },
            });
        });
    }
}
