import {
    idSchema,
    isoDateSchema,
    paginationFields,
    positiveQuantitySchema,
} from "@src/shared/validation/fields.js";
import { z } from "zod";
import { loanStatuses } from "./loan.dtos.js";

export const loanCreationKeySchema = z
    .uuid("O cabeçalho Idempotency-Key deve conter um UUID.")
    .toLowerCase()
    .optional();

export const createLoanSchema = z
    .object({
        clientId: idSchema,
        itemId: idSchema,
        loanDate: isoDateSchema,
        dueDate: isoDateSchema,
        loanQuantity: positiveQuantitySchema,
        returnDate: isoDateSchema.nullable().optional(),
    })
    .strict();

export const updateLoanSchema = z
    .object({
        loanDate: isoDateSchema.optional(),
        dueDate: isoDateSchema.optional(),
        returnDate: isoDateSchema.nullable().optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, "Informe ao menos um campo para atualização.");

export const renewLoanSchema = z
    .object({
        expectedUpdatedAt: isoDateSchema,
        dueDate: isoDateSchema,
    })
    .strict();

const loanFilterId = z
    .string()
    .regex(/^[0-9]+$/, "O ID deve ser um número inteiro.")
    .transform(Number)
    .pipe(idSchema)
    .optional();

export const loanListQuerySchema = z
    .object({
        ...paginationFields,
        status: z.enum(loanStatuses).default("all"),
        itemId: loanFilterId,
        clientId: loanFilterId,
        include: z
            .enum([
                "client",
                "item",
                "client,item",
                "item,client",
                "itemLocation",
                "client,itemLocation",
                "itemLocation,client",
            ])
            .optional(),
        order: z.enum(["recent", "due"]).default("recent"),
    })
    .strict();
