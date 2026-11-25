import { app } from "@src/app.js";
import { prisma } from "@src/lib/prisma.js";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("health checks", () => {
    afterEach(() => vi.restoreAllMocks());

    it("returns HTTP 503 until the database responds", async () => {
        vi.spyOn(prisma, "$queryRaw")
            .mockRejectedValueOnce(new Error("Database connection failed"))
            .mockResolvedValueOnce([{ "?column?": 1 }]);

        await request(app)
            .get("/health/ready")
            .expect(503, {
                error: {
                    code: "DATABASE_UNAVAILABLE",
                    message: "Banco de dados indisponível.",
                },
            });
        await request(app).get("/health/ready").expect(200, { status: "ready" });
    });

    it("checks liveness without a database query", async () => {
        const query = vi.spyOn(prisma, "$queryRaw");

        await request(app).get("/health/live").expect(200, { status: "ok" });
        expect(query).not.toHaveBeenCalled();
    });
});
