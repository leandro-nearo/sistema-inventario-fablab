import { app } from "@src/app.js";
import { prisma } from "@src/lib/prisma.js";
import { TokenService } from "@src/shared/services/token.service.js";
import { Bcrypt } from "@src/shared/utils/bcrypt.js";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const runDatabaseTests = process.env.RUN_DB_TESTS === "true";
const databaseSuite = runDatabaseTests ? describe : describe.skip;

databaseSuite("inventory API integration", () => {
    beforeAll(() => {
        const databaseName = new URL(process.env.DATABASE_URL ?? "").pathname.toLowerCase();
        if (!databaseName.includes("test")) {
            throw new Error("Os testes de integração exigem um banco cujo nome contenha 'test'.");
        }
    });

    beforeEach(async () => {
        await prisma.authToken.deleteMany();
        await prisma.loan.deleteMany();
        await prisma.inventoryAdjustment.deleteMany();
        await prisma.client.deleteMany();
        await prisma.item.deleteMany();
        await prisma.user.deleteMany();

        await prisma.user.create({
            data: {
                username: "admin",
                email: "admin@example.com",
                passwordHash: await Bcrypt.hashPassword("a-secure-test-password"),
                role: "ADMIN",
            },
        });
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    async function accessToken() {
        const response = await request(app).post("/auth/login").send({
            email: "admin@example.com",
            password: "a-secure-test-password",
        });
        expect(response.status).toBe(200);
        return response.body.accessToken as string;
    }

    it("requires an administrator to create users", async () => {
        const response = await request(app).post("/user").send({
            username: "operator",
            email: "operator@example.com",
            password: "a-secure-password",
            passwordConfirm: "a-secure-password",
        });

        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe("TOKEN_MISSING");
    });

    it("does not remove the last administrator", async () => {
        const token = await accessToken();
        const admin = await prisma.user.findUniqueOrThrow({
            where: { email: "admin@example.com" },
        });
        const response = await request(app)
            .delete(`/user/${admin.id}`)
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe("LAST_ADMIN");
        await expect(prisma.user.findUnique({ where: { id: admin.id } })).resolves.not.toBeNull();
    });

    it("allows role management but does not demote the last administrator", async () => {
        const token = await accessToken();
        const admin = await prisma.user.findUniqueOrThrow({
            where: { email: "admin@example.com" },
        });

        const blocked = await request(app)
            .patch(`/user/${admin.id}`)
            .set("Authorization", `Bearer ${token}`)
            .send({ role: "OPERATOR" });
        expect(blocked.status).toBe(409);
        expect(blocked.body.error.code).toBe("LAST_ADMIN");

        const created = await request(app)
            .post("/user")
            .set("Authorization", `Bearer ${token}`)
            .send({
                username: "second-admin",
                email: "second-admin@example.com",
                password: "a-secure-password",
                passwordConfirm: "a-secure-password",
                role: "ADMIN",
            });
        expect(created.status).toBe(201);
        expect(created.body.role).toBe("ADMIN");

        const demoted = await request(app)
            .patch(`/user/${admin.id}`)
            .set("Authorization", `Bearer ${token}`)
            .send({ role: "OPERATOR" });
        expect(demoted.status).toBe(200);
        expect(demoted.body.role).toBe("OPERATOR");
    });

    it("returns the account ID and current role for an authenticated session", async () => {
        await request(app).get("/auth/me").expect(401);

        const password = "session-test-password";
        const user = await prisma.user.create({
            data: {
                username: "session",
                email: "session@example.com",
                passwordHash: await Bcrypt.hashPassword(password),
                role: "OPERATOR",
            },
        });
        const login = await request(app)
            .post("/auth/login")
            .send({ email: user.email, password })
            .expect(200);
        const getAccount = () =>
            request(app).get("/auth/me").set("Authorization", `Bearer ${login.body.accessToken}`);

        await getAccount().expect("Cache-Control", "no-store").expect(200, {
            id: user.id,
            role: "OPERATOR",
        });
        await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
        await getAccount().expect(200, { id: user.id, role: "ADMIN" });
    });

    it("revokes a refresh token on logout", async () => {
        const login = await request(app).post("/auth/login").send({
            email: "admin@example.com",
            password: "a-secure-test-password",
        });

        const logout = await request(app)
            .post("/auth/logout")
            .send({ refreshToken: login.body.refreshToken });
        expect(logout.status).toBe(204);

        const refresh = await request(app)
            .post("/auth/refresh")
            .send({ refreshToken: login.body.refreshToken });
        expect(refresh.status).toBe(401);
        expect(refresh.body.error.code).toBe("REFRESH_TOKEN_INVALID");
    });

    it("matches the full email address at login", async () => {
        await prisma.user.create({
            data: {
                username: "lab-team",
                email: "lab-team@example.com",
                passwordHash: await Bcrypt.hashPassword("other-test-password"),
            },
        });
        const password = "inventory-test-password";
        const user = await prisma.user.create({
            data: {
                username: "lab_team",
                email: "Lab_Team@example.com",
                passwordHash: await Bcrypt.hashPassword(password),
            },
        });

        const { body } = await request(app)
            .post("/auth/login")
            .send({ email: "lab_team@example.com", password })
            .expect(200);

        expect(TokenService.verifyAccess(body.accessToken).sub).toBe(String(user.id));
    });

    it("rejects nested Prisma relation input", async () => {
        const token = await accessToken();
        const response = await request(app)
            .post("/client")
            .set("Authorization", `Bearer ${token}`)
            .send({
                name: "Cliente",
                email: "client@example.com",
                loans: { create: {} },
            });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("matches literal characters in searches and stock filters", async () => {
        const authorization = { Authorization: `Bearer ${await accessToken()}` };
        const item = await prisma.item.create({
            data: { name: "Torneira_50% inox", category: "Conexão_1", location: "Estante\\A" },
        });
        const otherItem = await prisma.item.create({
            data: { name: "Torneira X50 inox", category: "ConexãoX1", location: "EstanteA" },
        });
        const client = await prisma.client.create({
            data: { name: "Oficina 100%", email: "oficina@example.com" },
        });
        await prisma.client.create({
            data: { name: "Oficina 100 anos", email: "outra-oficina@example.com" },
        });
        const user = await prisma.user.create({
            data: {
                username: "lab_team",
                email: "lab-team@example.com",
                passwordHash: await Bcrypt.hashPassword("other-test-password"),
            },
        });

        const queries = [
            ["/item", { search: "_50%" }, item.id],
            ["/item", { search: "estante\\" }, item.id],
            ["/item", { search: "TORNEIRA", page: 2, pageSize: 1 }, otherItem.id],
            ["/item/by-category", { category: "CONEXÃO_1" }, item.id],
            ["/item/by-location", { location: "estante\\a" }, item.id],
            ["/client", { search: "100%" }, client.id],
            ["/user", { search: "_" }, user.id],
        ] as const;
        for (const [path, query, id] of queries) {
            const { body } = await request(app)
                .get(path)
                .set(authorization)
                .query(query)
                .expect(200);
            expect.soft(body, `${path} ${JSON.stringify(query)}`).toMatchObject([{ id }]);
        }
    });

    it("rejects null characters in database text", async () => {
        const authorization = { Authorization: `Bearer ${await accessToken()}` };
        const name = "Motor\0DC";
        const invalidText = {
            error: {
                code: "VALIDATION_ERROR",
                message: "O texto não pode conter caracteres nulos.",
            },
        };

        await request(app)
            .post("/item")
            .set(authorization)
            .send({ name, location: "Estoque", totalQuantity: 2 })
            .expect(400, invalidText);
        await request(app)
            .post("/client")
            .set(authorization)
            .send({ name, email: "client@example.com" })
            .expect(400, invalidText);
        await request(app)
            .patch("/item/1")
            .set(authorization)
            .send({ totalQuantity: 2, adjustmentReason: name })
            .expect(400, invalidText);
        for (const path of ["/item", "/client", "/user"]) {
            await request(app)
                .get(path)
                .set(authorization)
                .query({ search: name })
                .expect(400, invalidText);
        }
        await request(app)
            .get("/item/by-category")
            .set(authorization)
            .query({ category: name })
            .expect(400, invalidText);
        await request(app)
            .get("/item/by-location")
            .set(authorization)
            .query({ location: name })
            .expect(400, invalidText);
        expect(await prisma.item.count()).toBe(0);
    });

    it("filters and sorts items before pagination", async () => {
        const authorization = { Authorization: `Bearer ${await accessToken()}` };
        await prisma.item.createMany({
            data: [
                { name: "Cabo USB", availableQuantity: 2, totalQuantity: 3, location: "Caixa A" },
                { name: "Cabo HDMI", availableQuantity: 0, totalQuantity: 3, location: "Caixa A" },
                { name: "Alicate", availableQuantity: 1, totalQuantity: 1, location: "Caixa B" },
                { name: "Adaptador", availableQuantity: 0, totalQuantity: 0, location: "Caixa B" },
            ],
        });

        const cases = [
            [{ availability: "available", search: "cabo" }, ["Cabo USB"]],
            [{ availability: "unavailable" }, ["Cabo HDMI", "Adaptador"]],
            [{ availability: "unavailable", page: 2, pageSize: 1 }, ["Adaptador"]],
            [{}, ["Cabo USB", "Cabo HDMI", "Alicate", "Adaptador"]],
            [{ order: "desc" }, ["Adaptador", "Alicate", "Cabo HDMI", "Cabo USB"]],
            [{ order: "desc", availability: "unavailable", page: 2, pageSize: 1 }, ["Cabo HDMI"]],
        ] as const;
        for (const [query, names] of cases) {
            const { body } = await request(app)
                .get("/item")
                .set(authorization)
                .query(query)
                .expect(200);
            expect(body).toMatchObject(names.map((name) => ({ name })));
        }

        const invalid = await request(app)
            .get("/item")
            .set(authorization)
            .query({ availability: "unknown" })
            .expect(400);
        expect(invalid.body.error.code).toBe("VALIDATION_ERROR");

        await request(app).get("/item").set(authorization).query({ order: "unknown" }).expect(400);
    });

    it.each(["client@example.com", "CLIENT@EXAMPLE.COM"])(
        "returns the email conflict when %s is already registered",
        async (email) => {
            const authorization = { Authorization: `Bearer ${await accessToken()}` };
            const client = { name: "Cliente", email: "client@example.com" };
            await prisma.client.create({ data: { ...client, email } });

            await request(app)
                .post("/client")
                .set(authorization)
                .send(client)
                .expect(409, {
                    error: {
                        code: "REQUEST_ERROR",
                        message: "Este e-mail já está cadastrado no sistema.",
                    },
                });
        },
    );

    it("keeps stock consistent across quantity reductions and concurrent returns", async () => {
        const token = await accessToken();
        const authorization = { Authorization: `Bearer ${token}` };

        const client = await request(app)
            .post("/client")
            .set(authorization)
            .send({ name: "Cliente", email: "client@example.com" });
        const item = await request(app)
            .post("/item")
            .set(authorization)
            .send({ name: "Arduino", totalQuantity: 10, location: "A1" });

        const loan = await request(app).post("/loan").set(authorization).send({
            clientId: client.body.id,
            itemId: item.body.id,
            loanDate: "2026-09-01T10:00:00Z",
            dueDate: "2026-09-20T10:00:00Z",
            loanQuantity: 5,
        });
        expect(loan.status).toBe(201);

        const resized = await request(app)
            .patch(`/item/${item.body.id}`)
            .set(authorization)
            .send({ totalQuantity: 6, adjustmentReason: "Item danificado" });
        expect(resized.status).toBe(200);
        expect(resized.body.availableQuantity).toBe(1);
        await expect(
            prisma.inventoryAdjustment.findFirst({ where: { itemId: item.body.id } }),
        ).resolves.toMatchObject({
            previousTotal: 10,
            newTotal: 6,
            previousAvailable: 5,
            newAvailable: 1,
            reason: "Item danificado",
        });

        const returnBody = { returnDate: "2026-09-04T10:00:00Z" };
        const returns = await Promise.all([
            request(app).patch(`/loan/${loan.body.id}`).set(authorization).send(returnBody),
            request(app).patch(`/loan/${loan.body.id}`).set(authorization).send(returnBody),
        ]);
        expect(returns.map((response) => response.status)).toEqual([200, 200]);

        const storedItem = await prisma.item.findUniqueOrThrow({ where: { id: item.body.id } });
        expect(storedItem.availableQuantity).toBe(6);
        expect(storedItem.availableQuantity).toBeLessThanOrEqual(storedItem.totalQuantity);

        const reopened = await request(app)
            .patch(`/loan/${loan.body.id}`)
            .set(authorization)
            .send({ loanDate: "2026-09-05T10:00:00Z", returnDate: null });
        expect(reopened.status).toBe(200);

        const reopenedItem = await prisma.item.findUniqueOrThrow({ where: { id: item.body.id } });
        expect(reopenedItem.availableQuantity).toBe(1);
    });

    it("rejects a stock adjustment based on an old total quantity", async () => {
        const authorization = { Authorization: `Bearer ${await accessToken()}` };
        const item = await prisma.item.create({ data: { name: "Arduino", location: "A1" } });
        const path = `/item/${item.id}`;
        const patch = () => request(app).patch(path).set(authorization);

        await patch().send({ location: "A2", expectedTotalQuantity: 0 }).expect(400);

        const reason = "Contagem de estoque";
        const responses = await Promise.all(
            [2, 3].map((totalQuantity) =>
                patch().send({
                    name: `Arduino ${totalQuantity}`,
                    expectedTotalQuantity: 0,
                    totalQuantity,
                    adjustmentReason: reason,
                }),
            ),
        );
        expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
        const rejected = responses.find((response) => response.status === 409);
        expect(rejected?.body.error.code).toBe("ITEM_QUANTITY_CHANGED");

        const saved = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
        expect(saved).toMatchObject({
            name: `Arduino ${saved.totalQuantity}`,
            availableQuantity: saved.totalQuantity,
        });
        expect(saved.location).toBe("A1");
        expect(
            await prisma.inventoryAdjustment.findMany({ where: { itemId: item.id } }),
        ).toMatchObject([{ previousTotal: 0, newTotal: saved.totalQuantity, reason }]);
    });

    it("reserves the last unit once and keeps a loan closed when stock is empty", async () => {
        const authorization = { Authorization: `Bearer ${await accessToken()}` };
        const client = await prisma.client.create({
            data: { name: "Cliente", email: "client@example.com" },
        });
        const item = await prisma.item.create({
            data: { name: "Arduino", location: "A1", totalQuantity: 1, availableQuantity: 1 },
        });
        const loan = {
            clientId: client.id,
            itemId: item.id,
            loanDate: "2026-09-01",
            dueDate: "2026-09-20",
            loanQuantity: 1,
        };
        const create = () => request(app).post("/loan").set(authorization);
        const attempts = await Promise.all([create().send(loan), create().send(loan)]);
        expect(attempts.map(({ status }) => status).sort()).toEqual([201, 400]);
        const stockError = {
            code: "REQUEST_ERROR",
            message: "Quantidade máxima disponível em estoque: 0.",
        };
        expect(attempts.find(({ status }) => status === 400)?.body.error).toEqual(stockError);

        const returned = await create()
            .send({ ...loan, returnDate: loan.dueDate })
            .expect(201);
        await request(app)
            .patch(`/loan/${returned.body.id}`)
            .set(authorization)
            .send({ returnDate: null })
            .expect(400, { error: stockError });
        await expect(
            prisma.loan.findUniqueOrThrow({ where: { id: returned.body.id } }),
        ).resolves.toMatchObject({ returnDate: new Date(loan.dueDate) });
        await expect(
            prisma.item.findUniqueOrThrow({ where: { id: item.id } }),
        ).resolves.toMatchObject({ availableQuantity: 0 });
        expect(await prisma.loan.count({ where: { itemId: item.id } })).toBe(2);

        for (const returnDate of [null, loan.dueDate]) {
            const missing = await create().send({ ...loan, itemId: item.id + 1, returnDate });
            expect(missing.status).toBe(404);
            expect(missing.body.error.code).toBe("ITEM_NOT_FOUND");
        }
    });

    it("returns the same error for all actions on a missing loan", async () => {
        const authorization = { Authorization: `Bearer ${await accessToken()}` };
        const path = "/loan/1";
        const expected = {
            error: {
                code: "LOAN_NOT_FOUND",
                message: "Não foi possível encontrar um empréstimo com esse ID.",
            },
        };

        await request(app).get(path).set(authorization).expect(404, expected);
        await request(app)
            .patch(path)
            .set(authorization)
            .send({ dueDate: "2026-09-20" })
            .expect(404, expected);
        await request(app).delete(path).set(authorization).expect(404, expected);
    });

    it("cancels loans without deleting their audit history", async () => {
        const token = await accessToken();
        const authorization = { Authorization: `Bearer ${token}` };
        const client = await request(app)
            .post("/client")
            .set(authorization)
            .send({ name: "Cliente", email: "client@example.com" });
        const item = await request(app)
            .post("/item")
            .set(authorization)
            .send({ name: "Arduino", totalQuantity: 2, location: "A1" });
        const loan = await request(app).post("/loan").set(authorization).send({
            clientId: client.body.id,
            itemId: item.body.id,
            loanDate: "2026-09-01T10:00:00Z",
            dueDate: "2026-09-20T10:00:00Z",
            loanQuantity: 1,
        });

        const response = await request(app).delete(`/loan/${loan.body.id}`).set(authorization);
        expect(response.status).toBe(204);

        const storedLoan = await prisma.loan.findUniqueOrThrow({ where: { id: loan.body.id } });
        const storedItem = await prisma.item.findUniqueOrThrow({ where: { id: item.body.id } });
        expect(storedLoan.cancelledAt).not.toBeNull();
        expect(storedItem.availableQuantity).toBe(2);
    });

    it("filters loan pages by item and status", async () => {
        const authorization = { Authorization: `Bearer ${await accessToken()}` };
        const client = await prisma.client.create({
            data: { name: "Cliente", email: "client@example.com" },
        });
        const item = await prisma.item.create({
            data: { name: "Arduino", location: "A1", totalQuantity: 3, availableQuantity: 1 },
        });
        const otherItem = await prisma.item.create({
            data: { name: "Sensor", location: "A1", totalQuantity: 1, availableQuantity: 0 },
        });
        const loan = { clientId: client.id, itemId: item.id, loanQuantity: 1 };
        const first = await prisma.loan.create({
            data: { ...loan, loanDate: new Date("2026-09-01"), dueDate: new Date("2026-09-30") },
        });
        const second = await prisma.loan.create({
            data: { ...loan, loanDate: new Date("2026-09-02"), dueDate: new Date("2026-09-30") },
        });
        const later = new Date("2026-09-03");
        await prisma.loan.createMany({
            data: [
                { ...loan, loanDate: later, dueDate: later, returnDate: later },
                { ...loan, loanDate: later, dueDate: later, itemId: otherItem.id },
            ],
        });

        const getPage = (page: number) =>
            request(app)
                .get("/loan")
                .set(authorization)
                .query({ itemId: item.id, status: "active", page, pageSize: 1 })
                .expect(200);
        expect((await getPage(1)).body).toMatchObject([{ id: second.id }]);
        expect((await getPage(2)).body).toMatchObject([{ id: first.id }]);
        expect((await getPage(3)).body).toEqual([]);
    });

    it("rejects item filters outside the item ID format", async () => {
        const authorization = { Authorization: `Bearer ${await accessToken()}` };
        for (const query of ["itemId=0", "itemId=1e2", "itemId=2147483648", "itemId=1&itemId=2"]) {
            const response = await request(app)
                .get(`/loan?${query}`)
                .set(authorization)
                .expect(400);
            expect(response.body.error.code).toBe("VALIDATION_ERROR");
        }
    });

    it("uses the ID to order history pages when dates are equal", async () => {
        const authorization = { Authorization: `Bearer ${await accessToken()}` };
        const client = await prisma.client.create({
            data: { name: "Cliente", email: "client@example.com" },
        });
        const item = await prisma.item.create({
            data: { name: "Arduino", location: "A1", totalQuantity: 2, availableQuantity: 2 },
        });
        const date = new Date("2026-09-01T10:00:00Z");
        const loan = {
            clientId: client.id,
            itemId: item.id,
            loanDate: date,
            dueDate: date,
            returnDate: date,
            loanQuantity: 1,
        };
        const loans = await prisma.loan.createManyAndReturn({ data: [loan, loan] });
        const adjustments = await prisma.inventoryAdjustment.createManyAndReturn({
            data: [0, 1].map((previous) => ({
                itemId: item.id,
                previousTotal: previous,
                newTotal: previous + 1,
                previousAvailable: previous,
                newAvailable: previous + 1,
                createdAt: date,
                reason: "Entrada de material",
            })),
        });
        const loanIds = loans.map(({ id }) => id).sort((a, b) => b - a);
        const adjustmentIds = adjustments.map(({ id }) => id).sort((a, b) => b - a);

        for (const page of [1, 2]) {
            const getPage = (path: string) =>
                request(app).get(path).set(authorization).query({ page, pageSize: 1 }).expect(200);
            const list = await getPage("/loan");
            const history = await getPage(`/client/${client.id}/loans`);
            const audit = await getPage(`/item/${item.id}/adjustments`);
            expect(list.body).toMatchObject([{ id: loanIds[page - 1] }]);
            expect(history.body.loans).toMatchObject([{ id: loanIds[page - 1] }]);
            expect(audit.body).toMatchObject([{ id: adjustmentIds[page - 1] }]);
        }
    });
});
