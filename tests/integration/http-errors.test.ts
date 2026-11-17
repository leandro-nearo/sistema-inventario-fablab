import { app } from "@src/app.js";
import request from "supertest";
import { describe, it } from "vitest";

describe("JSON request errors", () => {
    it("returns HTTP 400 for invalid JSON", async () => {
        await request(app)
            .post("/auth/login")
            .set("Content-Type", "application/json")
            .send('{"email":')
            .expect(400, { error: { code: "INVALID_JSON", message: "JSON inválido." } });
    });

    it("returns HTTP 413 if the JSON body exceeds the limit", async () => {
        await request(app)
            .post("/client")
            .send({ name: "A".repeat(101 * 1024), email: "client@example.com" })
            .expect(413, {
                error: {
                    code: "PAYLOAD_TOO_LARGE",
                    message: "O corpo da requisição excede o limite permitido.",
                },
            });
    });
});
