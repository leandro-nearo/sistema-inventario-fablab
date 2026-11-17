import { MESSAGES } from "@src/constants/messages.js";
import { AppError } from "@src/shared/errors/app.error.js";
import { idSchema } from "@src/shared/validation/fields.js";

export class IdValidator {
    static validate(id: number) {
        if (id === null || id === undefined) {
            throw new AppError(MESSAGES.SHARED.VALIDATION.REQUIRED_FIELD(MESSAGES.FIELDS.ID));
        }

        if (!idSchema.safeParse(id).success) {
            throw new AppError(MESSAGES.SHARED.VALIDATION.INVALID_FIELD(MESSAGES.FIELDS.ID));
        }
    }
}
