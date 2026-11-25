import type { CreateLoanDTO, RenewLoanDTO, UpdateLoanDTO } from "@modules/loan/loan.dtos.js";
import { loanService } from "@modules/loan/loan.service.js";
import { MESSAGES } from "@src/constants/messages.js";
import { DateValidator } from "@src/shared/utils/validators/date.validator.js";
import { IdValidator } from "@src/shared/utils/validators/id.validator.js";
import { isoDateSchema, paginationFrom } from "@src/shared/validation/fields.js";
import type { Request, Response } from "express";
import { loanCreationKeySchema, loanListQuerySchema } from "./loan.schemas.js";

const expectedLoanVersion = isoDateSchema.transform((value) => new Date(value)).optional();

class LoanController {
    async create(req: Request, res: Response) {
        const data: CreateLoanDTO = req.body;
        const key = loanCreationKeySchema.parse(req.get("Idempotency-Key"));
        const { loan, created } = await loanService.create(data, Number(req.userId), key);
        return res.status(created ? 201 : 200).json(loan);
    }

    async list(req: Request, res: Response) {
        const query = loanListQuerySchema.parse(req.query);
        const include = query.include?.split(",") ?? [];
        const includeItemLocation = include.includes("itemLocation");
        const loans = await loanService.list({
            ...paginationFrom(query),
            status: query.status,
            ...(query.itemId !== undefined ? { itemId: query.itemId } : {}),
            ...(query.clientId !== undefined ? { clientId: query.clientId } : {}),
            includeClient: include.includes("client"),
            includeItem: include.includes("item") || includeItemLocation,
            includeItemLocation,
            order: query.order,
        });
        return res.json(loans);
    }

    async getById(req: Request, res: Response) {
        const id = Number(req.params.id);
        IdValidator.validate(id);
        const loan = await loanService.getById(id);
        return res.json(loan);
    }

    async returnById(req: Request, res: Response) {
        const id = Number(req.params.id);
        IdValidator.validate(id);
        const expectedUpdatedAt = expectedLoanVersion.parse(req.query.expectedUpdatedAt);
        const loan = await loanService.returnById(id, Number(req.userId), expectedUpdatedAt);
        return res.json(loan);
    }

    async renewById(req: Request, res: Response) {
        const id = Number(req.params.id);
        IdValidator.validate(id);
        const data: RenewLoanDTO = req.body;
        const loan = await loanService.renewById(id, {
            expectedUpdatedAt: new Date(data.expectedUpdatedAt),
            dueDate: new Date(data.dueDate),
        });
        return res.json(loan);
    }

    async updateById(req: Request, res: Response) {
        const loanId = Number(req.params.id);
        IdValidator.validate(loanId);
        const data: UpdateLoanDTO = req.body;

        const updateData: {
            loanDate?: Date;
            dueDate?: Date;
            returnDate?: Date | null;
        } = {};

        if (data.loanDate !== undefined) {
            DateValidator.validate(data.loanDate, MESSAGES.FIELDS.LOAN_DATE);
            updateData.loanDate = new Date(data.loanDate);
        }

        if (data.dueDate !== undefined) {
            DateValidator.validate(data.dueDate, MESSAGES.FIELDS.DUE_DATE);
            updateData.dueDate = new Date(data.dueDate);
        }

        if (data.returnDate !== undefined) {
            if (data.returnDate !== null) {
                DateValidator.validate(data.returnDate, MESSAGES.FIELDS.RETURN_DATE);
            }
            updateData.returnDate = data.returnDate === null ? null : new Date(data.returnDate);
        }

        const loan = await loanService.updateById(loanId, updateData, Number(req.userId));

        return res.json(loan);
    }

    async deleteById(req: Request, res: Response) {
        const loanId = Number(req.params.id);
        IdValidator.validate(loanId);
        const expectedUpdatedAt = expectedLoanVersion.parse(req.query.expectedUpdatedAt);
        await loanService.cancelById(loanId, Number(req.userId), expectedUpdatedAt);
        return res.status(204).send();
    }
}

const loanController = new LoanController();

export { loanController };
