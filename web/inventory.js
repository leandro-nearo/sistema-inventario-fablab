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

const pageSize = 20;
let tokens = null;
let page = 1;
let filters = { search: "", availability: "" };
let hasNext = false;
let pendingItems = null;

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

function updateControls() {
    const loading = pendingItems !== null;
    const focused = document.activeElement;
    previous.disabled = page === 1;
    next.disabled = !hasNext;
    for (const button of [searchButton, previous, next]) {
        button.setAttribute("aria-disabled", String(loading || button.disabled));
    }
    tableRegion.setAttribute("aria-busy", String(loading));
    pageLabel.textContent = `Página ${page}`;
    if ((focused === previous || focused === next) && focused.disabled) {
        (pagination.hidden ? searchButton : pageLabel).focus();
    }
}

function showLogin(message) {
    tokens = null;
    page = 1;
    filters = { search: "", availability: "" };
    hasNext = false;
    searchForm.reset();
    rows.replaceChildren();
    tableRegion.hidden = true;
    pagination.hidden = true;
    inventory.hidden = true;
    logout.hidden = true;
    login.hidden = false;
    loginStatus.textContent = message;
    emailField.focus();
}

async function getItems(path, session) {
    try {
        return await request(path, { accessToken: session.accessToken });
    } catch (error) {
        if (error.status !== 401 || session !== tokens) throw error;
    }

    const freshTokens = await request("/auth/refresh", {
        data: { refreshToken: session.refreshToken },
    });
    Object.assign(session, freshTokens);
    if (session === tokens) return request(path, { accessToken: session.accessToken });
}

async function loadPage(requestedPage, requestedFilters) {
    const session = tokens;
    if (pendingItems || !session) return;
    const { search, availability } = requestedFilters;
    const filterChanged = search !== filters.search || availability !== filters.availability;
    const query = new URLSearchParams({ page: requestedPage, pageSize, search });
    if (availability) query.set("availability", availability);
    pendingItems = getItems(`/item?${query}`, session);
    updateControls();
    inventoryStatus.textContent = "Carregando itens…";

    try {
        const items = await pendingItems;
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
            showLogin("Sua sessão expirou. Entre novamente.");
            return;
        }
        if (filterChanged) {
            tableRegion.hidden = true;
            pagination.hidden = true;
        }
        inventoryStatus.textContent = error.message;
    } finally {
        pendingItems = null;
        updateControls();
    }
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (loginButton.disabled) return;
    loginButton.disabled = true;
    loginStatus.textContent = "Entrando…";
    try {
        tokens = await request("/auth/login", {
            data: { email: emailField.value, password: passwordField.value },
        });
        passwordField.value = "";
        login.hidden = true;
        inventory.hidden = false;
        logout.hidden = false;
        inventoryTitle.focus();
        void loadPage(1, filters);
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

logout.addEventListener("click", async () => {
    const session = tokens;
    if (!session) return;
    showLogin("Sessão encerrada neste navegador.");
    loginButton.disabled = true;
    try {
        await pendingItems?.catch(() => null);
        await request("/auth/logout", { data: { refreshToken: session.refreshToken } });
    } catch {
        loginStatus.textContent =
            "Sessão encerrada neste navegador. A API não confirmou a revogação.";
    } finally {
        loginButton.disabled = false;
    }
});
