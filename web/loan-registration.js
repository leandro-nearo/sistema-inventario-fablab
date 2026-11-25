import { clientSearchPageSize, clientSearchPath } from "./client-search.js";
import { parseLocalDateTime } from "./local-date-time.js";

const dialog = document.querySelector("#loan-dialog");
const itemName = document.querySelector("#loan-item");
const stock = document.querySelector("#loan-stock");
const searchForm = document.querySelector("#loan-client-search");
const searchField = document.querySelector("#loan-client-query");
const searchButton = document.querySelector("#loan-search-button");
const searchStatus = document.querySelector("#loan-client-results");
const clientRegistration = document.querySelector("#loan-client-registration");
const clientForm = document.querySelector("#loan-client-create-form");
const clientFields = document.querySelector("#loan-client-create-fields");
const clientStatus = document.querySelector("#loan-client-create-status");
const saveClient = document.querySelector("#save-loan-client");
const form = document.querySelector("#loan-form");
const fields = document.querySelector("#loan-fields");
const client = document.querySelector("#loan-client");
const quantity = document.querySelector("#loan-quantity");
const due = document.querySelector("#loan-due");
const summary = document.querySelector("#loan-attempt-summary");
const status = document.querySelector("#loan-status");
const discard = document.querySelector("#discard-loan-attempt");
const closeButton = document.querySelector("#close-loan-dialog");
const save = document.querySelector("#save-loan");

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const attempts = new Map();
const unknownResult = "Não foi possível confirmar o cadastro. Reenvie a mesma tentativa.";

function creationKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
    ].join("-");
}

function previousAttempt(storageKey, itemId) {
    if (attempts.has(storageKey)) return attempts.get(storageKey);
    try {
        const attempt = JSON.parse(sessionStorage.getItem(storageKey));
        if (typeof attempt?.key === "string" && attempt.data?.itemId === itemId) return attempt;
    } catch {
        return null;
    }
    return null;
}

function rememberAttempt(context, attempt) {
    try {
        if (attempt) sessionStorage.setItem(context.storageKey, JSON.stringify(attempt));
        else sessionStorage.removeItem(context.storageKey);
    } catch {
        if (attempt) return false;
    }
    context.attempt = attempt;
    attempts.set(context.storageKey, attempt);
    return true;
}

function clearClients() {
    client.replaceChildren(new Option("Selecione um cliente", ""));
}

function clientOption({ id, name, email }) {
    return new Option(`${name} (${email})`, id);
}

export function createLoanRegistration(request, register) {
    let active = null;
    let searching = false;
    let submitting = false;

    function updateControls() {
        const attempt = active?.attempt;
        const creatingClient = Boolean(active?.creatingClient);
        searchForm.hidden = Boolean(attempt);
        clientRegistration.hidden = Boolean(attempt);
        fields.hidden = Boolean(attempt);
        fields.disabled = Boolean(attempt) || creatingClient;
        clientFields.disabled = creatingClient;
        saveClient.disabled = searching || creatingClient;
        summary.hidden = !attempt;
        discard.hidden = !attempt || submitting;
        closeButton.setAttribute("aria-disabled", String(submitting || creatingClient));
        searchButton.disabled = searching || creatingClient;
        searchField.disabled = creatingClient;
        save.setAttribute("aria-disabled", String(submitting));
        save.disabled = creatingClient || (!attempt && (!active?.available || !client.value));
        save.textContent = attempt && !submitting ? "Reenviar cadastro" : "Registrar empréstimo";
        if (attempt) {
            const { clientId, loanQuantity, dueDate } = attempt.data;
            summary.textContent = `Cliente #${clientId} · Quantidade ${loanQuantity} · Prazo ${dateFormat.format(new Date(dueDate))}`;
        }
    }

    function isOpen(context) {
        return active === context && dialog.open;
    }

    async function loadAvailability(context) {
        context.available = null;
        stock.textContent = "Consultando disponibilidade…";
        updateControls();
        try {
            const { item, serverTime } = await request(`/item/${context.itemId}`, {
                signal: context.controller.signal,
                withServerTime: true,
            });
            if (!isOpen(context)) return;
            if (!Number.isFinite(serverTime))
                throw new Error("Não foi possível consultar a hora do servidor.");
            context.serverTime = serverTime;
            context.readAt = performance.now();
            context.available = item.availableQuantity;
            quantity.max = String(context.available);
            stock.textContent = `Disponíveis para empréstimo: ${context.available}.`;
        } catch (error) {
            if (isOpen(context)) stock.textContent = error.message;
        }
        if (isOpen(context)) updateControls();
    }

    searchForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const context = active;
        if (!context || !dialog.open || searchButton.disabled || context.attempt) return;
        searching = true;
        clearClients();
        updateControls();
        searchStatus.textContent = "Buscando clientes…";
        try {
            const clients = await request(clientSearchPath(searchField.value), {
                signal: context.controller.signal,
            });
            if (!isOpen(context)) return;
            client.append(...clients.map(clientOption));
            if (clients.length === 0) searchStatus.textContent = "Nenhum cliente encontrado.";
            else if (clients.length === clientSearchPageSize)
                searchStatus.textContent = "20 resultados exibidos. Refine a busca se necessário.";
            else searchStatus.textContent = "Selecione o cliente na lista.";
        } catch (error) {
            if (isOpen(context)) searchStatus.textContent = error.message;
        } finally {
            if (isOpen(context)) {
                searching = false;
                updateControls();
            }
        }
    });

    clientForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const context = active;
        if (!context || !dialog.open || saveClient.disabled || context.attempt) return;
        const values = new FormData(clientForm);
        const name = values.get("name").trim();
        const email = values.get("email").trim().toLowerCase();
        const phone = values.get("phone").trim();
        const data = { name, email, ...(phone ? { phone } : {}) };
        context.creatingClient = true;
        updateControls();
        clientStatus.textContent = "Salvando cliente…";

        let found;
        let created = false;
        let message;
        try {
            found = await request("/client", { data });
            created = true;
            message = "Cliente cadastrado e selecionado.";
        } catch (error) {
            const rejected = error.status >= 400 && error.status < 500;
            message = rejected
                ? error.message
                : "Não foi possível confirmar o cadastro do cliente.";
            if (isOpen(context) && (error.status === 409 || !rejected)) {
                const query = new URLSearchParams({ email, pageSize: 1 });
                const clients = await request(`/client?${query}`, {
                    signal: context.controller.signal,
                }).catch(() => []);
                found = clients?.[0];
                if (found) {
                    message =
                        error.status === 409
                            ? "Já existe um cliente com esse e-mail. Confira e selecione o cadastro."
                            : "Cliente localizado pelo e-mail. Confira e selecione o cadastro.";
                }
            }
        }

        if (!isOpen(context)) return;
        context.creatingClient = false;
        if (found) {
            searchForm.reset();
            clientForm.reset();
            clientStatus.textContent = "";
            clientRegistration.open = false;
            clearClients();
            client.append(clientOption(found));
            if (created) client.value = found.id;
            searchStatus.textContent = message;
            updateControls();
            client.focus();
        } else {
            clientRegistration.open = true;
            clientStatus.textContent = message;
            updateControls();
            clientStatus.focus();
        }
    });

    client.addEventListener("change", updateControls);
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const context = active;
        if (!context || !dialog.open || submitting || save.disabled) return;
        const retry = Boolean(context.attempt);
        if (!retry) {
            const loanDate = new Date(context.serverTime + performance.now() - context.readAt);
            const dueDate = parseLocalDateTime(due.value);
            if (!dueDate) {
                status.textContent = "Informe um horário local válido para a devolução.";
                due.focus();
                return;
            }
            if (dueDate < loanDate) {
                status.textContent = "Informe um prazo de devolução posterior ao cadastro.";
                due.focus();
                return;
            }
            const saved = rememberAttempt(context, {
                key: creationKey(),
                data: {
                    clientId: Number(client.value),
                    itemId: context.itemId,
                    loanDate: loanDate.toISOString(),
                    dueDate: dueDate.toISOString(),
                    loanQuantity: quantity.valueAsNumber,
                },
            });
            if (!saved) {
                status.textContent = "O navegador não conseguiu guardar a tentativa nesta aba.";
                return;
            }
        }
        submitting = true;
        save.focus();
        updateControls();
        status.textContent = "Registrando empréstimo…";
        try {
            const { data, key } = context.attempt;
            await register(data, key);
            rememberAttempt(context, null);
            if (isOpen(context)) dialog.close();
        } catch (error) {
            if (isOpen(context)) {
                if (!retry && [400, 404, 409].includes(error.status)) {
                    rememberAttempt(context, null);
                    if (error.code === "CLIENT_NOT_FOUND") clearClients();
                    void loadAvailability(context);
                    (error.code === "CLIENT_NOT_FOUND" ? searchField : quantity).focus();
                }
                status.textContent =
                    error.status >= 400 && error.status < 500 ? error.message : unknownResult;
            }
        } finally {
            submitting = false;
            if (isOpen(context)) updateControls();
        }
    });

    discard.addEventListener("click", () => {
        if (!active?.attempt || submitting) return;
        if (
            !window.confirm(
                "O empréstimo pode já ter sido registrado. Descartar a tentativa mesmo assim?",
            )
        )
            return;
        rememberAttempt(active, null);
        status.textContent = "";
        void loadAvailability(active);
        searchField.focus();
    });

    function clear() {
        active?.controller.abort();
        active = null;
        searching = false;
        itemName.textContent = "";
        stock.textContent = "";
        searchStatus.textContent = "";
        summary.textContent = "";
        status.textContent = "";
        clientStatus.textContent = "";
        form.reset();
        searchForm.reset();
        clientForm.reset();
        clientRegistration.open = false;
        clearClients();
    }

    closeButton.addEventListener("click", () => {
        if (!submitting && !active?.creatingClient) dialog.close();
    });
    dialog.addEventListener("cancel", (event) => {
        if (submitting || active?.creatingClient) event.preventDefault();
    });
    dialog.addEventListener("close", () => {
        if (!dialog.open) clear();
    });

    return {
        open(item, userId) {
            if (dialog.open || submitting) return;
            clear();
            const storageKey = `fablab:loan:${userId}:${item.id}`;
            const attempt = previousAttempt(storageKey, item.id);
            active = {
                itemId: item.id,
                storageKey,
                attempt,
                available: null,
                controller: new AbortController(),
            };
            itemName.textContent = item.name;
            if (attempt) status.textContent = unknownResult;
            updateControls();
            dialog.showModal();
            if (attempt) save.focus();
            else void loadAvailability(active);
        },
        close() {
            dialog.close();
            clear();
        },
    };
}
