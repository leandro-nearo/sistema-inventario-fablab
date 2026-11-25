import { prisma } from "@src/lib/prisma.js";
import { AppError } from "@src/shared/errors/app.error.js";
import { Router } from "express";

const healthRouter = Router();

healthRouter.get("/live", (_req, res) => {
    res.status(200).json({ status: "ok" });
});

healthRouter.get("/ready", async (_req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
    } catch (cause) {
        throw new AppError("Banco de dados indisponível.", 503, "DATABASE_UNAVAILABLE", { cause });
    }
    res.status(200).json({ status: "ready" });
});

export { healthRouter };
