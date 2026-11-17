import type { Loan, Prisma } from "@src/generated/prisma/client.js";
import { prisma } from "@src/lib/prisma.js";
import { InsufficientStockError } from "@src/shared/errors/insufficient-stock.error.js";
import {
    LoanCancelledError,
    LoanDateOrderError,
    RelatedResourceNotFoundError,
} from "@src/shared/errors/loan-state.error.js";

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

export interface LoanRepository {
    createWithStockReservation(data: LoanCreateData): Promise<Loan>;
    list(options: {
        skip: number;
        take: number;
        status: "all" | "active" | "returned" | "cancelled" | "overdue";
    }): Promise<Loan[]>;
    findById(id: number): Promise<Loan | null>;
    updateWithStock(id: number, data: LoanUpdateData, actorId: number): Promise<Loan | null>;
    cancelWithStock(id: number, actorId: number): Promise<Loan | null>;
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
    async createWithStockReservation(data: LoanCreateData): Promise<Loan> {
        return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

            return tx.loan.create({ data });
        });
    }

    list({
        skip,
        take,
        status,
    }: {
        skip: number;
        take: number;
        status: "all" | "active" | "returned" | "cancelled" | "overdue";
    }) {
        const now = new Date();
        const where: Prisma.LoanWhereInput | undefined =
            status === "active"
                ? { returnDate: null, cancelledAt: null }
                : status === "returned"
                  ? { returnDate: { not: null }, cancelledAt: null }
                  : status === "cancelled"
                    ? { cancelledAt: { not: null } }
                    : status === "overdue"
                      ? { returnDate: null, cancelledAt: null, dueDate: { lt: now } }
                      : undefined;

        return prisma.loan.findMany({
            ...(where ? { where } : {}),
            orderBy: [{ loanDate: "desc" }, { id: "desc" }],
            skip,
            take,
        });
    }

    findById(id: number) {
        return prisma.loan.findUnique({ where: { id } });
    }

    async updateWithStock(id: number, data: LoanUpdateData, actorId: number): Promise<Loan | null> {
        return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const rows = await tx.$queryRaw<Loan[]>`
                SELECT * FROM "Loan" WHERE "id" = ${id} FOR UPDATE
            `;
            const existing = rows[0];

            if (!existing) {
                return null;
            }

            if (existing.cancelledAt !== null) throw new LoanCancelledError();

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
                    ...(isBeingReturned ? { returnedById: actorId } : {}),
                    ...(isBeingReopened ? { returnedById: null } : {}),
                },
            });
        });
    }

    async cancelWithStock(id: number, actorId: number): Promise<Loan | null> {
        return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const rows = await tx.$queryRaw<Loan[]>`
                SELECT * FROM "Loan" WHERE "id" = ${id} FOR UPDATE
            `;
            const existing = rows[0];

            if (!existing) {
                return null;
            }

            if (existing.cancelledAt !== null) return existing;

            if (existing.returnDate === null) {
                await tx.item.update({
                    where: { id: existing.itemId },
                    data: { availableQuantity: { increment: existing.loanQuantity } },
                    select: { id: true },
                });
            }

            return tx.loan.update({
                where: { id },
                data: { cancelledAt: new Date(), cancelledById: actorId },
            });
        });
    }
}
