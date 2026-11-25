import { app } from "@src/app.js";
import request from "supertest";
import { describe, expect, it } from "vitest";

describe("inventory page", () => {
    it("serves the page and its assets", async () => {
        await request(app).get("/inventario").expect(301).expect("Location", "/inventario/");
        const page = await request(app)
            .get("/inventario/")
            .expect(200)
            .expect("Content-Type", /text\/html/)
            .expect("Content-Security-Policy", /script-src 'self'/)
            .expect(/Estoque de itens/)
            .expect(/<label for="availability">Disponibilidade<\/label>/)
            .expect(/<label for="order">Ordenação<\/label>/)
            .expect(/<dialog id="item-dialog"[^>]*aria-labelledby="item-dialog-title"/);
        expect(page.headers["content-security-policy"]).not.toContain("upgrade-insecure-requests");
        await request(app)
            .get("/inventario/inventory.css")
            .expect(200)
            .expect("Content-Type", /text\/css/);
        await request(app)
            .get("/inventario/inventory.js")
            .expect(200)
            .expect("Content-Type", /javascript/);
        await request(app)
            .get("/inventario/adjustment-history.js")
            .expect(200)
            .expect("Content-Type", /javascript/);
    });
});
