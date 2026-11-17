import { createClientSchema } from "@src/modules/client/client.schemas.js";
import { createItemSchema } from "@src/modules/item/item.schemas.js";
import { createLoanSchema } from "@src/modules/loan/loan.schemas.js";
import { createUserSchema } from "@src/modules/user/user.schemas.js";
import { IdValidator } from "@src/shared/utils/validators/id.validator.js";
import { QuantityValidator } from "@src/shared/utils/validators/quantity.validator.js";
import { idSchema, positiveQuantitySchema, quantitySchema } from "@src/shared/validation/fields.js";
import { describe, expect, it } from "vitest";

describe("input schemas", () => {
    it("rejects unknown relation fields instead of forwarding them to Prisma", () => {
        const result = createClientSchema.safeParse({
            name: "Cliente",
            email: "client@example.com",
            loans: { create: {} },
        });

        expect(result.success).toBe(false);
    });

    it("normalizes user identity fields", () => {
        const result = createUserSchema.parse({
            username: "  operator  ",
            email: "  OPERATOR@EXAMPLE.COM ",
            password: "a-secure-password",
            passwordConfirm: "a-secure-password",
        });

        expect(result.username).toBe("operator");
        expect(result.email).toBe("operator@example.com");
    });

    it("accepts only known user roles", () => {
        const accepted = createUserSchema.safeParse({
            username: "administrator",
            email: "administrator@example.com",
            password: "a-secure-password",
            passwordConfirm: "a-secure-password",
            role: "ADMIN",
        });
        const rejected = createUserSchema.safeParse({
            username: "administrator",
            email: "administrator@example.com",
            password: "a-secure-password",
            passwordConfirm: "a-secure-password",
            role: "SUPERUSER",
        });

        expect(accepted.success).toBe(true);
        expect(rejected.success).toBe(false);
    });

    it("accepts international phone lengths and stores only digits", () => {
        const result = createClientSchema.parse({
            name: "Cliente",
            email: "client@example.com",
            phone: "+351 912 345 678",
        });

        expect(result.phone).toBe("351912345678");
    });

    it("rejects fractional inventory quantities", () => {
        const result = createItemSchema.safeParse({
            name: "Arduino",
            totalQuantity: 1.5,
            location: "Armário A",
        });

        expect(result.success).toBe(false);
    });

    it("limits IDs and quantities to the PostgreSQL integer range", () => {
        const maximum = 2_147_483_647;
        for (const schema of [idSchema, quantitySchema, positiveQuantitySchema]) {
            expect(schema.safeParse(maximum).success).toBe(true);
            expect(schema.safeParse(maximum + 1).success).toBe(false);
        }
        expect(() => IdValidator.validate(maximum)).not.toThrow();
        expect(() => IdValidator.validate(maximum + 1)).toThrow();
        expect(() => QuantityValidator.validate(maximum)).not.toThrow();
        expect(() => QuantityValidator.validate(maximum + 1)).toThrow();
    });

    it("requires unambiguous ISO dates", () => {
        const result = createLoanSchema.safeParse({
            clientId: 1,
            itemId: 1,
            loanDate: "09/04/2026",
            dueDate: "2026-09-10T10:00:00Z",
            loanQuantity: 1,
        });

        expect(result.success).toBe(false);
    });

    it("rejects impossible calendar dates", () => {
        const result = createLoanSchema.safeParse({
            clientId: 1,
            itemId: 1,
            loanDate: "2026-02-30",
            dueDate: "2026-03-10",
            loanQuantity: 1,
        });

        expect(result.success).toBe(false);
    });
});
