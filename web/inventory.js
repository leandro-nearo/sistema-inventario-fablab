const login = document.querySelector("#login");
const loginForm = document.querySelector("#login-form");
const loginButton = document.querySelector("#login-button");
const loginStatus = document.querySelector("#login-status");
const emailField = document.querySelector("#email");
const passwordField = document.querySelector("#password");
const logout = document.querySelector("#logout");
const inventory = document.querySelector("#inventory");
const inventoryTitle = document.querySelector("#inventory-title");
const searchForm = document.querySelector("#search-form");
const searchField = document.querySelector("#search");
const availabilityField = document.querySelector("#availability");
const searchButton = searchForm.querySelector("button");
const inventoryStatus = document.querySelector("#inventory-status");
const tableRegion = document.querySelector("#table-region");
const rows = document.querySelector("#items");
const pagination = document.querySelector("#pagination");
const previous = document.querySelector("#previous");
const next = document.querySelector("#next");
const pageLabel = document.querySelector("#page");
const createItem = document.querySelector("#create-item");
const itemDialog = document.querySelector("#item-dialog");
const itemForm = document.querySelector("#item-form");
const itemFields = document.querySelector("#item-fields");
const itemFormStatus = document.querySelector("#item-form-status");
const itemQuantity = document.querySelector("#item-quantity");
const saveItem = document.querySelector("#save-item");
const cancelItem = document.querySelector("#cancel-item");
const itemResult = document.querySelector("#item-result");

const pageSize = 20;
let tokens = null;
let page = 1;
let filters = { search: "", availability: "" };
let hasNext = false;
let pendingRequest = null;
let retainedDraft = null;
let itemNeedsReview = false;

async function request(path, { data, accessToken } = {}) {
    let response;
    try {
        response = await fetch(path, {
            method: data ? "POST" : "GET",
            headers: {
                ...(data ? { "Content-Type": "application/json" } : {}),
                ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: data ? JSON.stringify(data) : undefined,
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        throw new Error("Falha de conexão. Tente novamente.");
    }

    if (response.status === 204) return;
    const body = await response.json().catch(() => null);
    if (response.ok && body !== null) return body;
    throw Object.assign(new Error(body?.error?.message || "Falha na consulta. Tente novamente."), {
        status: response.status,
    });
}

function getSessionUserId(accessToken) {
    const payload = accessToken.split(".")[1]?.replaceAll("-", "+").replaceAll("_", "/");
    const userId = payload ? JSON.parse(atob(payload)).sub : null;
    if (typeof userId !== "string" || !userId) {
        throw new Error("Não foi possível identificar a conta.");
    }
    return userId;
}

function updateControls() {
    const loading = pendingRequest !== null;
    const focused = document.activeElement;
    previous.disabled = page === 1;
    next.disabled = !hasNext;
    for (const button of [searchButton, previous, next, createItem]) {
        button.setAttribute("aria-disabled", String(loading || button.disabled));
    }
    const saving = loading && itemDialog.open;
    itemFields.disabled = saving;
    saveItem.setAttribute("aria-disabled", String(saving));
    saveItem.textContent = itemNeedsReview ? "Reenviar item" : "Salvar item";
    cancelItem.setAttribute("aria-disabled", String(saving));
    tableRegion.setAttribute("aria-busy", String(loading));
    pageLabel.textContent = `Página ${page}`;
    if ((focused === previous || focused === next) && focused.disabled) {
        (pagination.hidden ? searchButton : pageLabel).focus();
    }
}

function resetItemDraft() {
    itemForm.reset();
    itemFormStatus.textContent = "";
    itemNeedsReview = false;
}

function showLogin(message, preserveDraft = false) {
    retainedDraft = preserveDraft ? { userId: tokens.userId, reopen: itemDialog.open } : null;
    tokens = null;
    page = 1;
    filters = { search: "", availability: "" };
    hasNext = false;
    searchForm.reset();
    itemDialog.close();
    if (!retainedDraft) resetItemDraft();
    itemResult.textContent = "";
    rows.replaceChildren();
    tableRegion.hidden = true;
    pagination.hidden = true;
    inventory.hidden = true;
    logout.hidden = true;
    login.hidden = false;
    loginStatus.textContent = message;
    emailField.focus();
}

async function requestWithSession(path, session, data) {
    try {
        return await request(path, { data, accessToken: session.accessToken });
    } catch (error) {
        if (error.status !== 401 || session !== tokens) throw error;
    }

    const freshTokens = await request("/auth/refresh", {
        data: { refreshToken: session.refreshToken },
    });
    Object.assign(session, freshTokens);
    if (session === tokens) return request(path, { data, accessToken: session.accessToken });
}

async function loadPage(requestedPage, requestedFilters) {
    const session = tokens;
    if (pendingRequest || !session) return;
    const { search, availability } = requestedFilters;
    const filterChanged = search !== filters.search || availability !== filters.availability;
    const query = new URLSearchParams({ page: requestedPage, pageSize, search });
    if (availability) query.set("availability", availability);
    pendingRequest = requestWithSession(`/item?${query}`, session);
    updateControls();
    inventoryStatus.textContent = "Carregando itens…";

    try {
        const items = await pendingRequest;
        if (session !== tokens) return;
        if (items.length === 0 && requestedPage > page && !filterChanged) {
            hasNext = false;
            inventoryStatus.textContent = "Você chegou ao fim da lista.";
            return;
        }

        page = requestedPage;
        filters = requestedFilters;
        hasNext = items.length === pageSize;
        rows.replaceChildren(
            ...items.map((item) => {
                const row = document.createElement("tr");
                const name = document.createElement("th");
                name.scope = "row";
                name.textContent = item.name;
                row.append(name);
                for (const value of [
                    item.availableQuantity,
                    item.totalQuantity,
                    item.category ?? "—",
                    item.location,
                ]) {
                    row.insertCell().textContent = value;
                }
                return row;
            }),
        );
        tableRegion.hidden = items.length === 0;
        pagination.hidden = items.length === 0 && page === 1;
        inventoryStatus.textContent =
            items.length === 0
                ? "Nenhum item encontrado."
                : `${items.length} ${items.length === 1 ? "item nesta página" : "itens nesta página"}.`;
    } catch (error) {
        if (session !== tokens) return;
        if (error.status === 401) {
            showLogin("Sua sessão expirou. Entre novamente.", true);
            return;
        }
        if (filterChanged) {
            tableRegion.hidden = true;
            pagination.hidden = true;
        }
        inventoryStatus.textContent = error.message;
    } finally {
        pendingRequest = null;
        updateControls();
    }
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (loginButton.disabled) return;
    loginButton.disabled = true;
    loginStatus.textContent = "Entrando…";
    try {
        const email = emailField.value.trim().toLowerCase();
        const credentials = await request("/auth/login", {
            data: { email, password: passwordField.value },
        });
        const session = { ...credentials, userId: getSessionUserId(credentials.accessToken) };
        const sameAccount = retainedDraft?.userId === session.userId;
        const reopenItem = sameAccount && retainedDraft.reopen;
        if (!sameAccount) resetItemDraft();
        retainedDraft = null;
        tokens = session;
        passwordField.value = "";
        login.hidden = true;
        inventory.hidden = false;
        logout.hidden = false;
        inventoryTitle.focus();
        void loadPage(1, filters).then(() => {
            if (reopenItem && session === tokens) openItemDialog();
        });
    } catch (error) {
        loginStatus.textContent = error.message;
    } finally {
        loginButton.disabled = false;
    }
});

searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void loadPage(1, { search: searchField.value.trim(), availability: availabilityField.value });
});
previous.addEventListener("click", () => void loadPage(page - 1, filters));
next.addEventListener("click", () => void loadPage(page + 1, filters));

function openItemDialog() {
    if (!tokens || pendingRequest) return;
    if (!itemNeedsReview) itemFormStatus.textContent = "";
    itemResult.textContent = "";
    itemDialog.showModal();
    updateControls();
}

createItem.addEventListener("click", openItemDialog);

cancelItem.addEventListener("click", () => {
    if (!pendingRequest) itemDialog.close();
});
itemDialog.addEventListener("cancel", (event) => {
    if (pendingRequest) event.preventDefault();
});
itemDialog.addEventListener("close", () => {
    if (itemNeedsReview) void loadPage(page, filters);
});

itemForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const session = tokens;
    if (pendingRequest || !session || !itemDialog.open) return;
    if (
        itemNeedsReview &&
        !window.confirm(
            "O item pode já ter sido cadastrado. Confirme que consultou o estoque antes de reenviar.",
        )
    ) {
        return;
    }
    itemNeedsReview = false;
    const fields = new FormData(itemForm);
    const data = {
        name: fields.get("name"),
        location: fields.get("location"),
        category: fields.get("category"),
        totalQuantity: itemQuantity.valueAsNumber,
    };
    saveItem.focus();
    pendingRequest = requestWithSession("/item", session, data);
    updateControls();
    itemFormStatus.textContent = "Salvando item…";

    try {
        const item = await pendingRequest;
        if (session !== tokens) return;
        itemDialog.close();
        resetItemDraft();
        itemResult.textContent = `Item “${item.name}” cadastrado.`;
    } catch (error) {
        if (session !== tokens) return;
        if (error.status === 401) {
            showLogin("Sua sessão expirou. Entre novamente.", true);
            return;
        }
        const rejected = error.status >= 400 && error.status < 500;
        itemNeedsReview = !rejected;
        itemFormStatus.textContent = rejected
            ? error.message
            : "Não foi possível confirmar o cadastro. Consulte o estoque antes de enviar novamente.";
        return;
    } finally {
        pendingRequest = null;
        updateControls();
    }
    void loadPage(page, filters);
});

logout.addEventListener("click", async () => {
    const session = tokens;
    if (!session) return;
    showLogin("Sessão encerrada neste navegador.");
    loginButton.disabled = true;
    try {
        await pendingRequest?.catch(() => null);
        await request("/auth/logout", { data: { refreshToken: session.refreshToken } });
    } catch {
        loginStatus.textContent =
            "Sessão encerrada neste navegador. A API não confirmou a revogação.";
    } finally {
        loginButton.disabled = false;
    }
});
