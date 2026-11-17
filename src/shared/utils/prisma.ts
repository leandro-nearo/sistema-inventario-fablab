import { MESSAGES } from "@src/constants/messages.js";
import { Prisma } from "@src/generated/prisma/client.js";
import { AppError } from "@src/shared/errors/app.error.js";

export function toPrismaAppError(err: unknown): AppError | undefined {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
        switch (err.code) {
            case "P2002": {
                const meta = (err.meta ?? {}) as {
                    driverAdapterError?: {
                        cause?: {
                            constraint?: {
                                fields?: string[];
                                index?: string;
                            };
                        };
                    };
                    target?: string[];
                };

                const modelName = err.meta?.modelName;
                const constraint = meta.driverAdapterError?.cause?.constraint;
                const fields = meta.target ?? constraint?.fields;
                const index = constraint?.index;

                if (
                    fields?.[0] === "email" ||
                    index === `${modelName}_email_key` ||
                    index === `${modelName}_email_lower_key`
                ) {
                    const message =
                        modelName === "Client"
                            ? MESSAGES.CLIENT.CONFLICT.EMAIL_EXISTS
                            : MESSAGES.USER.CONFLICT.EMAIL_EXISTS;
                    return new AppError(message, 409);
                }

                return new AppError("Conflito de restrição única.", 409);
            }
            case "P2025": {
                const modelName = err.meta?.modelName;
                const message =
                    modelName === "Item"
                        ? MESSAGES.ITEM.NOT_FOUND.BY_ID
                        : modelName === "Client"
                          ? MESSAGES.CLIENT.NOT_FOUND.BY_ID
                          : modelName === "Loan"
                            ? MESSAGES.LOAN.NOT_FOUND.BY_ID
                            : MESSAGES.USER.NOT_FOUND.BY_ID;
                return new AppError(message, 404);
            }
            case "P2020":
                return new AppError(
                    MESSAGES.SHARED.VALIDATION.QUANTITY_INVALID,
                    400,
                    "VALIDATION_ERROR",
                );
            case "P2003":
                return new AppError(
                    "O registro não pode ser alterado ou removido porque possui dados relacionados.",
                    409,
                    "RELATED_RECORD_CONFLICT",
                );
            default:
                return new AppError("Erro interno de banco de dados.", 500, "DATABASE_ERROR");
        }
    }

    if (err instanceof Prisma.PrismaClientValidationError) {
        return new AppError("Dados inválidos para a operação.", 400, "VALIDATION_ERROR");
    }

    return undefined;
}
