import { createClientLoanSearch } from "./client-loan-search.js";
import { createItemRecords } from "./item-records.js";
import { createLoanRegistration } from "./loan-registration.js";
import { createLoanRenewal } from "./loan-renewal.js";
import { createLoanReopenings } from "./loan-reopenings.js";

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
const openLoanDeadlines = document.querySelector("#open-loan-deadlines");
const openClientLoans = document.querySelector("#open-client-loans");
const itemDialog = document.querySelector("#item-dialog");
const itemDialogTitle = document.querySelector("#item-dialog-title");
const itemForm = document.querySelector("#item-form");
const itemFields = document.querySelector("#item-fields");
const itemFormStatus = document.querySelector("#item-form-status");
const itemName = document.querySelector("#item-name");
const itemLocation = document.querySelector("#item-location");
const itemCategory = document.querySelector("#item-category");
const itemMetadataInputs = { name: itemName, location: itemLocation, category: itemCategory };
const itemMetadataLabels = { name: "nome", location: "localização", category: "categoria" };
const itemQuantity = document.querySelector("#item-quantity");
const registeredQuantity = document.querySelector("#item-registered-quantity");
const itemAdjustment = document.querySelector("#item-adjustment");
const adjustmentReason = document.querySelector("#item-adjustment-reason");
const saveItem = document.querySelector("#save-item");
const cancelItem = document.querySelector("#cancel-item");
const itemResult = document.querySelector("#item-result");
const openHistory = document.querySelector("#open-adjustment-history");
const openLoans = document.querySelector("#open-item-loans");
const openLoanRegistration = document.querySelector("#open-loan-registration");
const loanDialog = document.querySelector("#loan-dialog");
const renewalDialog = document.querySelector("#loan-renewal");
const reopeningsDialog = document.querySelector("#loan-reopenings");
const recordsDialog = document.querySelector("#item-records");
const clientLoanSearchDialog = document.querySelector("#client-loan-search");
const itemRecords = createItemRecords(recordsDialog, fetchItemRecords, {
    returnLoan,
    cancelLoan,
    reopenLoan,
    renewLoan: (loan, opener) => loanRenewal.open(loan, opener, tokens.userId),
    showReopenings: (id, opener) => loanReopenings.open(id, opener),
    fallbackFocus: cancelItem,
});
const clientLoanSearch = createClientLoanSearch(
    clientLoanSearchDialog,
    (path, options) => requestInDialog(clientLoanSearchDialog, path, options),
    (client, opener) => {
        if (tokens && !pendingRequest) itemRecords.open({ client, opener });
    },
);
const loanRegistration = createLoanRegistration(
    (path, options) => requestInDialog(loanDialog, path, options),
    registerLoan,
);
const loanRenewal = createLoanRenewal(
    (id, data) => writeLoan(`/loan/${id}/renew`, { data }),
    (id, signal) => requestInDialog(renewalDialog, `/loan/${id}`, { signal }),
    itemRecords.refresh,
);
const loanReopenings = createLoanReopenings(
    reopeningsDialog,
    fetchLoanReopenings,
    document.querySelector("#close-item-records"),
);

const pageSize = 20;
const defaultFilters = { search: "", availability: "", order: "desc" };
let tokens = null;
let page = 1;
let filters = defaultFilters;
let hasNext = false;
let pendingRequest = null;
let retainedDraft = null;
let itemNeedsReview = false;
let itemListRefreshPage = null;
let editingItem = null;
let uncertainEditFields = [];

async function request(
    path,
    {
        data,
        method = data ? "POST" : "GET",
        accessToken,
        signal,
        idempotencyKey,
        withServerTime,
        withPageInfo,
    } = {},
) {
    let response;
    try {
        const timeout = AbortSignal.timeout(10_000);
        response = await fetch(path, {
            method,
            headers: {
                ...(data ? { "Content-Type": "application/json" } : {}),
                ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
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
    if (response.ok && body !== null) {
        if (withPageInfo) {
            const nextPage = response.headers.get("X-Has-Next-Page");
            return { records: body, hasNext: nextPage === null ? null : nextPage === "true" };
        }
        return withServerTime
            ? { item: body, serverTime: Date.parse(response.headers.get("Date")) }
            : body;
    }
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
        openLoanDeadlines,
        openClientLoans,
        ...rows.querySelectorAll(".edit-item"),
    ]) {
        button.setAttribute("aria-disabled", String(loading || button.disabled));
    }
    const saving = loading && itemDialog.open;
    itemFields.disabled = saving;
    const adminAccess = tokens?.role === "ADMIN";
    openHistory.hidden = !editingItem || !adminAccess;
    itemRecords.setAdminAccess(adminAccess);
    if (!adminAccess) loanReopenings.denyAccess();
    openLoans.hidden = !editingItem;
    openLoanRegistration.hidden = !editingItem;
    for (const button of [openHistory, openLoans, openLoanRegistration]) {
        button.setAttribute("aria-disabled", String(loading));
    }
    updateAdjustmentControls();
    saveItem.setAttribute("aria-disabled", String(saving));
    const refreshTotal = Boolean(editingItem?.totalNeedsRefresh);
    const refreshFields = Boolean(editingItem?.fieldsNeedRefresh);
    saveItem.formNoValidate = refreshTotal || refreshFields;
    saveItem.textContent = refreshFields
        ? "Consultar dados atuais"
        : refreshTotal
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
    itemListRefreshPage = null;
    editingItem = null;
    uncertainEditFields = [];
}

function showLogin(message, preserveDraft = false) {
    retainedDraft = preserveDraft
        ? { userId: tokens.userId, reopen: itemDialog.open, reopenLoan: loanDialog.open }
        : null;
    tokens = null;
    page = 1;
    filters = defaultFilters;
    hasNext = false;
    itemListRefreshPage = null;
    searchForm.reset();
    loanRenewal.close(preserveDraft);
    loanReopenings.close();
    loanRegistration.close();
    itemRecords.close();
    clientLoanSearch.close();
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

function clearAdminAccess(session) {
    session.role = "OPERATOR";
    session.roleRequest = null;
    updateControls();
}

async function fetchItemRecords({ kind, item, client }, { page, pageSize, loanStatus, signal }) {
    const session = tokens;
    const adjustments = kind === "adjustments";
    if (!session || (adjustments && session.role !== "ADMIN")) throw new Error("Acesso negado.");
    const query = new URLSearchParams({ page, pageSize });
    if (!adjustments) {
        query.set("status", loanStatus);
        if (loanStatus === "upcoming" || (!item && !client)) query.set("order", "due");
        if (item) {
            query.set("itemId", item.id);
            query.set("include", "client");
        } else if (client) {
            query.set("clientId", client.id);
            query.set("include", "itemLocation");
        } else {
            query.set("include", "client,itemLocation");
        }
    }
    const path = adjustments ? `/item/${item.id}/adjustments` : "/loan";
    try {
        return await requestWithSession(`${path}?${query}`, session, {
            signal,
            withPageInfo: true,
        });
    } catch (error) {
        if (session === tokens && !signal.aborted && recordsDialog.open) {
            if (error.status === 401) showLogin("Sua sessão expirou. Entre novamente.", true);
            if (adjustments && error.status === 403) clearAdminAccess(session);
        }
        throw error;
    }
}

async function requestInDialog(dialog, path, options) {
    const session = tokens;
    if (!session) throw new Error("Sua sessão expirou.");
    try {
        return await requestWithSession(path, session, options);
    } catch (error) {
        if (error.status === 401 && session === tokens && !options.signal?.aborted && dialog.open) {
            showLogin("Sua sessão expirou. Entre novamente.", true);
        }
        throw error;
    }
}

async function fetchLoanReopenings(id, { page, pageSize, signal }) {
    const session = tokens;
    if (session?.role !== "ADMIN") throw new Error("Acesso negado.");
    const query = new URLSearchParams({ page, pageSize });
    try {
        return await requestInDialog(reopeningsDialog, `/loan/${id}/reopenings?${query}`, {
            signal,
            withPageInfo: true,
        });
    } catch (error) {
        if (
            error.status === 403 &&
            session === tokens &&
            !signal.aborted &&
            reopeningsDialog.open
        ) {
            clearAdminAccess(session);
        }
        throw error;
    }
}

function returnLoan(loan) {
    const query = new URLSearchParams({ expectedUpdatedAt: loan.updatedAt });
    return writeLoan(`/loan/${loan.id}/return?${query}`, { method: "POST" }, "unavailable");
}

function reopenLoan(loan) {
    const query = new URLSearchParams({ expectedUpdatedAt: loan.updatedAt });
    return writeLoan(
        `/loan/${loan.id}?${query}`,
        { method: "PATCH", data: { returnDate: null } },
        "available",
    );
}

async function cancelLoan(loan) {
    const session = tokens;
    const query = new URLSearchParams({ expectedUpdatedAt: loan.updatedAt });
    try {
        await writeLoan(`/loan/${loan.id}?${query}`, { method: "DELETE" }, "unavailable");
    } catch (error) {
        if (error.status === 403 && session === tokens) clearAdminAccess(session);
        throw error;
    }
}

async function registerLoan(data, idempotencyKey) {
    const loan = await writeLoan("/loan", { data, idempotencyKey }, "available");
    const outcome = loan.cancelledAt
        ? "já cancelado"
        : loan.returnDate
          ? "já devolvido"
          : "registrado";
    itemFormStatus.textContent = `Empréstimo #${loan.id} ${outcome}.`;
}

async function writeLoan(path, options, affectedAvailability) {
    const session = tokens;
    if (!session || pendingRequest) throw new Error("Aguarde a operação atual.");
    if (affectedAvailability) {
        if (filters.availability === affectedAvailability) itemListRefreshPage = 1;
        else itemListRefreshPage ??= page;
    }
    pendingRequest = requestWithSession(path, session, options);
    updateControls();
    try {
        return await pendingRequest;
    } catch (error) {
        if (error.status === 401 && session === tokens) {
            showLogin("Sua sessão expirou. Entre novamente.", true);
        }
        throw error;
    } finally {
        pendingRequest = null;
        updateControls();
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
    const requestPage = () => requestWithSession(`/item?${query}`, session, { withPageInfo: true });
    pendingRequest = requestPage();
    updateControls();
    inventoryStatus.textContent = "Carregando itens…";

    try {
        let response = await pendingRequest;
        if (session !== tokens) return;
        void loadAccountRole(session);
        let loadedPage = requestedPage;
        if (response.records.length === 0 && !filterChanged) {
            if (requestedPage > page) {
                hasNext = false;
                inventoryStatus.textContent = "Você chegou ao fim da lista.";
                return;
            }
            if (requestedPage > 1) {
                loadedPage = 1;
                query.set("page", "1");
                pendingRequest = requestPage();
                response = await pendingRequest;
                if (session !== tokens) return;
            }
        }

        const { records: items, hasNext: nextPage } = response;
        page = loadedPage;
        filters = requestedFilters;
        hasNext = nextPage ?? items.length === pageSize;
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
        const reopenLoan = reopenItem && retainedDraft.reopenLoan;
        if (!sameAccount) resetItemDraft();
        retainedDraft = null;
        tokens = session;
        passwordField.value = "";
        login.hidden = true;
        inventory.hidden = false;
        logout.hidden = false;
        inventoryTitle.focus();
        void loadPage(1, filters).then(() => {
            if (reopenItem && session === tokens) {
                openItemDialog();
                if (reopenLoan) openLoanDialog();
            }
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
    if (!itemNeedsReview) itemFormStatus.textContent = editingItem?.reviewMessage ?? "";
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

function populateItemMetadata(item) {
    for (const [key, input] of Object.entries(itemMetadataInputs)) {
        input.value = item?.[key] ?? "";
    }
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
        populateItemMetadata(item);
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
openLoanDeadlines.addEventListener("click", () => {
    if (tokens && !pendingRequest && !itemDialog.open) {
        itemRecords.open({ opener: openLoanDeadlines });
    }
});
openClientLoans.addEventListener("click", () => {
    if (tokens && !pendingRequest && !itemDialog.open) clientLoanSearch.open(openClientLoans);
});

function openLoanDialog() {
    if (editingItem && tokens && !pendingRequest && itemDialog.open) {
        loanRegistration.open(editingItem.original, tokens.userId);
    }
}

openLoanRegistration.addEventListener("click", openLoanDialog);

for (const [button, kind] of [
    [openHistory, "adjustments"],
    [openLoans, "loans"],
]) {
    button.addEventListener("click", () => {
        if (editingItem && tokens && !pendingRequest && !button.hidden) {
            itemRecords.open({ item: editingItem.original, kind, opener: button });
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
    if (itemNeedsReview || itemListRefreshPage !== null) {
        const refreshPage =
            itemListRefreshPage ?? (!editingItem && filters.order === "desc" ? 1 : page);
        itemListRefreshPage = null;
        void loadPage(refreshPage, filters);
    }
});

function refreshStockAfterRecords() {
    if (
        recordsDialog.open ||
        itemDialog.open ||
        clientLoanSearchDialog.open ||
        itemListRefreshPage === null ||
        !tokens
    ) {
        return;
    }
    const refreshPage = itemListRefreshPage;
    itemListRefreshPage = null;
    void loadPage(refreshPage, filters);
}

recordsDialog.addEventListener("close", refreshStockAfterRecords);
clientLoanSearchDialog.addEventListener("close", refreshStockAfterRecords);

function showItemReview(message) {
    editingItem.reviewMessage = message;
    itemFormStatus.textContent = message;
}

async function refreshItemQuantity(path, session) {
    itemListRefreshPage ??= page;
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
        showItemReview(
            quantityChanged()
                ? `O total registrado mudou para ${item.totalQuantity}. Revise o ajuste antes de salvar.`
                : "O total registrado já corresponde ao valor informado.",
        );
    } catch (error) {
        if (session !== tokens) return;
        if (error.status === 401) {
            showLogin("Sua sessão expirou. Entre novamente.", true);
            return;
        }
        showItemReview(error.message);
    }
}

async function refreshItemFields(path, session) {
    itemListRefreshPage ??= page;
    editingItem.fieldsNeedRefresh = true;
    const draft = itemChanges();
    const previous = editingItem.original;
    try {
        pendingRequest = requestWithSession(path, session);
        updateControls();
        itemFormStatus.textContent = "Consultando dados atuais do item…";
        const item = await pendingRequest;
        if (session !== tokens) return;
        populateItemMetadata(item);
        editingItem.baseline = readItemFields();
        editingItem.original = item;
        editingItem.fieldsNeedRefresh = false;
        for (const [key, value] of Object.entries(draft)) {
            itemMetadataInputs[key].value = value ?? "";
        }
        uncertainEditFields = uncertainEditFields.filter((field) => field === "totalQuantity");
        itemNeedsReview = uncertainEditFields.length > 0;
        const remaining = Object.keys(itemChanges());
        const conflicts = remaining
            .filter((key) => previous[key] !== item[key])
            .map(
                (key) => `${itemMetadataLabels[key]} ${item[key] ? `“${item[key]}”` : "sem valor"}`,
            );
        const message = conflicts.length
            ? `O estoque registra ${conflicts.join(", ")}. Revise o rascunho antes de salvar.`
            : remaining.length || quantityChanged()
              ? "Dados atuais consultados. Revise o rascunho antes de salvar."
              : "Os campos editados já correspondem aos dados atuais.";
        showItemReview(message);
    } catch (error) {
        if (session !== tokens) return;
        if (error.status === 401) {
            showLogin("Sua sessão expirou. Entre novamente.", true);
            return;
        }
        showItemReview(error.message);
    }
}

itemForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const session = tokens;
    if (pendingRequest || !session || !itemDialog.open) return;
    const editingId = editingItem?.id;
    const path = editingId ? `/item/${editingId}` : "/item";
    if (editingItem?.fieldsNeedRefresh || editingItem?.totalNeedsRefresh) {
        saveItem.focus();
        try {
            if (editingItem.fieldsNeedRefresh) await refreshItemFields(path, session);
            else await refreshItemQuantity(path, session);
        } finally {
            pendingRequest = null;
            updateControls();
        }
        return;
    }
    const fields = itemChanges();
    if (editingId && Object.keys(fields).length) {
        fields.expectedFields = Object.fromEntries(
            Object.keys(fields).map((key) => [key, editingItem.original[key]]),
        );
    }
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
    const refreshPage = itemListRefreshPage ?? (!editingId && filters.order === "desc" ? 1 : page);
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
        if (editingId && error.code === "ITEM_FIELDS_CHANGED") {
            await refreshItemFields(path, session);
            return;
        }
        const rejected = error.status >= 400 && error.status < 500;
        if (!rejected) {
            itemNeedsReview = true;
            if (editingId) {
                uncertainEditFields = Object.keys(data).filter(
                    (field) =>
                        !["expectedTotalQuantity", "expectedFields", "adjustmentReason"].includes(
                            field,
                        ),
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
    void loadPage(refreshPage, filters);
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
