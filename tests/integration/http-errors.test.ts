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

    it.each([
        ["Content-Type", "application/json; charset=iso-8859-1"],
        ["Content-Encoding", "compress"],
    ])("returns HTTP 415 for an unsupported %s value", async (header, value) => {
        await request(app)
            .post("/auth/login")
            .set("Content-Type", "application/json")
            .set(header, value)
            .send("{}")
            .expect(415, {
                error: {
                    code: "UNSUPPORTED_MEDIA_TYPE",
                    message: "Codificação do corpo da requisição não suportada.",
                },
            });
    });
});
