import { createItemRecords } from "./item-records.js";

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
const orderField = document.querySelector("#order");
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
const itemDialogTitle = document.querySelector("#item-dialog-title");
const itemForm = document.querySelector("#item-form");
const itemFields = document.querySelector("#item-fields");
const itemFormStatus = document.querySelector("#item-form-status");
const itemName = document.querySelector("#item-name");
const itemLocation = document.querySelector("#item-location");
const itemCategory = document.querySelector("#item-category");
const itemQuantity = document.querySelector("#item-quantity");
const registeredQuantity = document.querySelector("#item-registered-quantity");
const itemAdjustment = document.querySelector("#item-adjustment");
const adjustmentReason = document.querySelector("#item-adjustment-reason");
const saveItem = document.querySelector("#save-item");
const cancelItem = document.querySelector("#cancel-item");
const itemResult = document.querySelector("#item-result");
const openHistory = document.querySelector("#open-adjustment-history");
const openLoans = document.querySelector("#open-active-loans");
const recordsDialog = document.querySelector("#item-records");
const itemRecords = createItemRecords(recordsDialog, fetchItemRecords, cancelItem);

const pageSize = 20;
const defaultFilters = { search: "", availability: "", order: "desc" };
let tokens = null;
let page = 1;
let filters = defaultFilters;
let hasNext = false;
let pendingRequest = null;
let retainedDraft = null;
let itemNeedsReview = false;
let itemListNeedsRefresh = false;
let editingItem = null;
let uncertainEditFields = [];

async function request(path, { data, method = data ? "POST" : "GET", accessToken, signal } = {}) {
    let response;
    try {
        const timeout = AbortSignal.timeout(10_000);
        response = await fetch(path, {
            method,
            headers: {
                ...(data ? { "Content-Type": "application/json" } : {}),
                ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: data ? JSON.stringify(data) : undefined,
            cache: "no-store",
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
    } catch {
        throw new Error("Falha de conexão. Tente novamente.");
    }

    if (response.status === 204) return;
    const body = await response.json().catch(() => null);
    if (response.ok && body !== null) return body;
    throw Object.assign(new Error(body?.error?.message || "Falha na consulta. Tente novamente."), {
        status: response.status,
        code: body?.error?.code,
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
    for (const button of [
        searchButton,
        previous,
        next,
        createItem,
        ...rows.querySelectorAll(".edit-item"),
    ]) {
        button.setAttribute("aria-disabled", String(loading || button.disabled));
    }
    const saving = loading && itemDialog.open;
    itemFields.disabled = saving;
    openHistory.hidden = !editingItem || tokens?.role !== "ADMIN";
    openLoans.hidden = !editingItem;
    for (const button of [openHistory, openLoans]) {
        button.setAttribute("aria-disabled", String(loading));
    }
    updateAdjustmentControls();
    saveItem.setAttribute("aria-disabled", String(saving));
    const refreshTotal = Boolean(editingItem?.totalNeedsRefresh);
    saveItem.formNoValidate = refreshTotal;
    saveItem.textContent = refreshTotal
        ? "Consultar total atual"
        : itemNeedsReview
          ? "Reenviar item"
          : "Salvar item";
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
    itemListNeedsRefresh = false;
    editingItem = null;
    uncertainEditFields = [];
}

function showLogin(message, preserveDraft = false) {
    retainedDraft = preserveDraft ? { userId: tokens.userId, reopen: itemDialog.open } : null;
    tokens = null;
    page = 1;
    filters = defaultFilters;
    hasNext = false;
    searchForm.reset();
    itemRecords.close();
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

async function requestWithSession(path, session, options) {
    const accessToken = session.accessToken;
    try {
        return await request(path, { ...options, accessToken });
    } catch (error) {
        if (error.status !== 401 || session !== tokens || options?.signal?.aborted) throw error;
    }

    if (session.accessToken === accessToken) {
        // A renovação troca o token. As consultas simultâneas usam a mesma resposta.
        session.refreshing ??= request("/auth/refresh", {
            data: { refreshToken: session.refreshToken },
        })
            .then((freshTokens) => Object.assign(session, freshTokens))
            .finally(() => {
                session.refreshing = null;
            });
        await session.refreshing;
    }
    if (session === tokens) return request(path, { ...options, accessToken: session.accessToken });
}

async function loadAccountRole(session) {
    const roleRequest = request("/auth/me", { accessToken: session.accessToken }).catch(() => null);
    session.roleRequest = roleRequest;
    const account = await roleRequest;
    if (session !== tokens || session.roleRequest !== roleRequest || !account) return;
    session.role = account.role;
    updateControls();
}

async function fetchItemRecords(kind, id, page, pageSize, signal) {
    const session = tokens;
    const adjustments = kind === "adjustments";
    if (!session || (adjustments && session.role !== "ADMIN")) throw new Error("Acesso negado.");
    const query = new URLSearchParams({ page, pageSize });
    if (!adjustments) {
        query.set("status", "active");
        query.set("itemId", id);
    }
    const path = adjustments ? `/item/${id}/adjustments` : "/loan";
    try {
        return await requestWithSession(`${path}?${query}`, session, { signal });
    } catch (error) {
        if (session === tokens && !signal.aborted && recordsDialog.open) {
            if (error.status === 401) showLogin("Sua sessão expirou. Entre novamente.", true);
            if (adjustments && error.status === 403) {
                session.role = "OPERATOR";
                session.roleRequest = null;
                updateControls();
            }
        }
        throw error;
    }
}

async function loadPage(requestedPage, requestedFilters) {
    const session = tokens;
    if (pendingRequest || !session) return;
    const { search, availability, order } = requestedFilters;
    const filterChanged =
        search !== filters.search ||
        availability !== filters.availability ||
        order !== filters.order;
    const query = new URLSearchParams({ page: requestedPage, pageSize, search, order });
    if (availability) query.set("availability", availability);
    pendingRequest = requestWithSession(`/item?${query}`, session);
    updateControls();
    inventoryStatus.textContent = "Carregando itens…";

    try {
        const items = await pendingRequest;
        if (session !== tokens) return;
        void loadAccountRole(session);
        if (items.length === 0 && requestedPage > page && !filterChanged) {
            hasNext = false;
            inventoryStatus.textContent = "Você chegou ao fim da lista.";
            return;
        }

        page = requestedPage;
        filters = requestedFilters;
        hasNext = items.length === pageSize;
        const focusedItemId = document.activeElement?.dataset?.itemId;
        rows.replaceChildren(
            ...items.map((item) => {
                const row = document.createElement("tr");
                const name = document.createElement("th");
                name.scope = "row";
                const edit = document.createElement("button");
                edit.type = "button";
                edit.className = "edit-item";
                edit.dataset.itemId = String(item.id);
                edit.setAttribute("aria-label", `Editar ${item.name}`);
                edit.setAttribute("aria-haspopup", "dialog");
                edit.textContent = item.name;
                edit.addEventListener("click", () => selectItem(item));
                name.append(edit);
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
        if (focusedItemId) {
            (rows.querySelector(`[data-item-id="${focusedItemId}"]`) ?? searchButton).focus();
        }
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
    void loadPage(1, {
        search: searchField.value.trim(),
        availability: availabilityField.value,
        order: orderField.value,
    });
});
previous.addEventListener("click", () => void loadPage(page - 1, filters));
next.addEventListener("click", () => void loadPage(page + 1, filters));

function openItemDialog() {
    if (!tokens || pendingRequest) return;
    itemDialogTitle.textContent = editingItem ? "Editar item" : "Cadastrar item";
    if (!itemNeedsReview) itemFormStatus.textContent = "";
    itemResult.textContent = "";
    itemDialog.showModal();
    updateControls();
}

function quantityChanged() {
    return (
        editingItem !== null &&
        (itemQuantity.valueAsNumber !== editingItem.totalQuantity ||
            uncertainEditFields.includes("totalQuantity"))
    );
}

function updateAdjustmentControls() {
    const adjusting = quantityChanged();
    registeredQuantity.hidden = !editingItem;
    registeredQuantity.textContent = editingItem?.totalNeedsRefresh
        ? "Total registrado indisponível."
        : editingItem
          ? `Total registrado ${editingItem.totalQuantity}`
          : "";
    itemAdjustment.hidden = !adjusting;
    adjustmentReason.disabled = !adjusting;
    adjustmentReason.required = adjusting;
}

itemQuantity.addEventListener("input", updateAdjustmentControls);

function readItemFields() {
    return {
        name: itemName.value.trim(),
        location: itemLocation.value.trim(),
        category: itemCategory.value.trim() || null,
    };
}

function itemChanges() {
    const fields = readItemFields();
    if (!editingItem) return fields;
    const changes = {};
    // O servidor pode ter aplicado os campos de um envio sem confirmação.
    for (const [key, value] of Object.entries(fields)) {
        if (value !== editingItem.baseline[key]) changes[key] = value;
        else if (uncertainEditFields.includes(key)) changes[key] = editingItem.original[key];
    }
    return changes;
}

function selectItem(item) {
    if (!tokens || pendingRequest) return;
    const switching = item?.id !== editingItem?.id;
    const fields = itemChanges();
    const hasDraft =
        itemNeedsReview ||
        (editingItem
            ? Object.keys(fields).length > 0 || quantityChanged()
            : Boolean(fields.name || fields.location || fields.category || itemQuantity.value));
    if (switching && hasDraft && !window.confirm("Descartar o rascunho atual?")) return;
    if (switching || !hasDraft) {
        resetItemDraft();
        itemName.value = item?.name ?? "";
        itemLocation.value = item?.location ?? "";
        itemCategory.value = item?.category ?? "";
        itemQuantity.value = item ? String(item.totalQuantity) : "";
        editingItem = item
            ? {
                  id: item.id,
                  original: item,
                  baseline: readItemFields(),
                  totalQuantity: item.totalQuantity,
              }
            : null;
    }
    openItemDialog();
}

createItem.addEventListener("click", () => selectItem(null));

for (const [button, kind] of [
    [openHistory, "adjustments"],
    [openLoans, "loans"],
]) {
    button.addEventListener("click", () => {
        if (editingItem && tokens && !pendingRequest && !button.hidden) {
            itemRecords.open(editingItem.original, kind, button);
        }
    });
}

cancelItem.addEventListener("click", () => {
    if (!pendingRequest) itemDialog.close();
});
itemDialog.addEventListener("cancel", (event) => {
    if (pendingRequest) event.preventDefault();
});
itemDialog.addEventListener("close", () => {
    if (itemNeedsReview || itemListNeedsRefresh) {
        itemListNeedsRefresh = false;
        void loadPage(!editingItem && filters.order === "desc" ? 1 : page, filters);
    }
});

async function refreshItemQuantity(path, session) {
    itemListNeedsRefresh = true;
    editingItem.totalNeedsRefresh = true;
    try {
        pendingRequest = requestWithSession(path, session);
        updateControls();
        itemFormStatus.textContent = "Consultando o total registrado…";
        const item = await pendingRequest;
        if (session !== tokens) return;
        editingItem.totalQuantity = item.totalQuantity;
        editingItem.totalNeedsRefresh = false;
        uncertainEditFields = uncertainEditFields.filter((field) => field !== "totalQuantity");
        itemNeedsReview = uncertainEditFields.length > 0;
        itemFormStatus.textContent = quantityChanged()
            ? `O total registrado mudou para ${item.totalQuantity}. Revise o ajuste antes de salvar.`
            : "O total registrado já corresponde ao valor informado.";
    } catch (error) {
        if (session !== tokens) return;
        if (error.status === 401) {
            showLogin("Sua sessão expirou. Entre novamente.", true);
            return;
        }
        itemFormStatus.textContent = error.message;
    }
}

itemForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const session = tokens;
    if (pendingRequest || !session || !itemDialog.open) return;
    const editingId = editingItem?.id;
    const path = editingId ? `/item/${editingId}` : "/item";
    if (editingItem?.totalNeedsRefresh) {
        try {
            await refreshItemQuantity(path, session);
        } finally {
            pendingRequest = null;
            updateControls();
        }
        return;
    }
    const fields = itemChanges();
    if (quantityChanged()) {
        fields.totalQuantity = itemQuantity.valueAsNumber;
        fields.expectedTotalQuantity = editingItem.totalQuantity;
        fields.adjustmentReason = adjustmentReason.value.trim();
    }
    if (editingId && Object.keys(fields).length === 0) {
        itemFormStatus.textContent = "Altere algum dado para salvar.";
        return;
    }
    if (
        itemNeedsReview &&
        !window.confirm(
            `${editingId ? "A alteração pode já ter sido gravada." : "O item pode já ter sido cadastrado."} Confirme que consultou o estoque antes de reenviar.`,
        )
    ) {
        return;
    }
    const data = editingId
        ? fields
        : { ...fields, category: fields.category ?? "", totalQuantity: itemQuantity.valueAsNumber };
    saveItem.focus();
    pendingRequest = requestWithSession(path, session, {
        method: editingId ? "PATCH" : "POST",
        data,
    });
    updateControls();
    itemFormStatus.textContent = "Salvando item…";

    try {
        const item = await pendingRequest;
        if (session !== tokens) return;
        itemDialog.close();
        resetItemDraft();
        itemResult.textContent = `Item “${item.name}” ${editingId ? "atualizado" : "cadastrado"}.`;
    } catch (error) {
        if (session !== tokens) return;
        if (error.status === 401) {
            showLogin("Sua sessão expirou. Entre novamente.", true);
            return;
        }
        if (editingId && error.code === "ITEM_QUANTITY_CHANGED") {
            await refreshItemQuantity(path, session);
            return;
        }
        const rejected = error.status >= 400 && error.status < 500;
        if (!rejected) {
            itemNeedsReview = true;
            if (editingId) {
                uncertainEditFields = Object.keys(data).filter(
                    (field) => field !== "expectedTotalQuantity" && field !== "adjustmentReason",
                );
            }
        }
        itemFormStatus.textContent = rejected
            ? error.message
            : "Não foi possível confirmar a gravação. Consulte o estoque antes de enviar novamente.";
        return;
    } finally {
        pendingRequest = null;
        updateControls();
    }
    void loadPage(!editingId && filters.order === "desc" ? 1 : page, filters);
});

logout.addEventListener("click", async () => {
    const session = tokens;
    if (!session) return;
    showLogin("Sessão encerrada neste navegador.");
    loginButton.disabled = true;
    try {
        await pendingRequest?.catch(() => null);
        await session.refreshing?.catch(() => null);
        await request("/auth/logout", { data: { refreshToken: session.refreshToken } });
    } catch {
        loginStatus.textContent =
            "Sessão encerrada neste navegador. A API não confirmou a revogação.";
    } finally {
        loginButton.disabled = false;
    }
});
