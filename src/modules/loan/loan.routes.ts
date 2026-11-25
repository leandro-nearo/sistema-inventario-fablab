import { loanController } from "@modules/loan/loan.controller.js";
import { authMiddleware } from "@src/middlewares/authMiddleware.js";
import { requireRole } from "@src/middlewares/roleMiddleware.js";
import { validateBody } from "@src/middlewares/validateMiddleware.js";
import { Router } from "express";
import { createLoanSchema, renewLoanSchema, updateLoanSchema } from "./loan.schemas.js";

const loanRouter = Router();

loanRouter.post(
    "/",
    authMiddleware,
    requireRole("ADMIN", "OPERATOR"),
    validateBody(createLoanSchema),
    loanController.create,
);
loanRouter.get("/", authMiddleware, loanController.list);
loanRouter.get("/:id", authMiddleware, loanController.getById);
loanRouter.get(
    "/:id/reopenings",
    authMiddleware,
    requireRole("ADMIN"),
    loanController.listReopenings,
);
loanRouter.post(
    "/:id/return",
    authMiddleware,
    requireRole("ADMIN", "OPERATOR"),
    loanController.returnById,
);
loanRouter.post(
    "/:id/renew",
    authMiddleware,
    requireRole("ADMIN", "OPERATOR"),
    validateBody(renewLoanSchema),
    loanController.renewById,
);
loanRouter.patch(
    "/:id",
    authMiddleware,
    requireRole("ADMIN", "OPERATOR"),
    validateBody(updateLoanSchema),
    loanController.updateById,
);
loanRouter.delete("/:id", authMiddleware, requireRole("ADMIN"), loanController.deleteById);

export { loanRouter };
