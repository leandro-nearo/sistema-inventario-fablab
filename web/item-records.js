const closeButton = document.querySelector("#close-item-records");
const title = document.querySelector("#records-title");
const name = document.querySelector("#records-item");
const loanFilters = document.querySelector("#loan-records-filters");
const loanStatusField = document.querySelector("#loan-records-status");
const loanStatusOptions = Array.from(loanStatusField.options);
const deadlineOptions = loanStatusOptions.filter(({ value }) =>
    ["overdue", "upcoming"].includes(value),
);
const result = document.querySelector("#records-result");
const status = document.querySelector("#records-status");
const region = document.querySelector("#records-region");
const entries = document.querySelector("#records-entries");
const pagination = document.querySelector("#records-pagination");
const previous = document.querySelector("#records-previous");
const next = document.querySelector("#records-next");
const pageLabel = document.querySelector("#records-page");

const pageSize = 10;
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const emptyLoanMessages = {
    all: "Nenhum empréstimo registrado.",
    active: "Nenhum empréstimo ativo.",
    overdue: "Nenhum empréstimo atrasado.",
    upcoming: "Nenhum empréstimo com prazo nos próximos 7 dias.",
    returned: "Nenhum empréstimo devolvido.",
    cancelled: "Nenhum empréstimo cancelado.",
};
const views = {
    adjustments: {
        title: "Histórico de ajustes",
        region: "Registros de ajuste",
        pagination: "Páginas do histórico de ajustes",
        loading: "Carregando ajustes…",
        empty: "Nenhum ajuste registrado.",
        end: "Você chegou ao fim do histórico.",
        singular: "ajuste",
        plural: "ajustes",
        render: renderAdjustment,
    },
    loans: {
        title: "Empréstimos do item",
        region: "Registros de empréstimo",
        pagination: "Páginas dos empréstimos do item",
        loading: "Carregando empréstimos…",
        end: "Você chegou ao fim da lista.",
        singular: "empréstimo",
        plural: "empréstimos",
        render: renderLoan,
    },
};

function renderDate(value) {
    const date = document.createElement("time");
    date.dateTime = value;
    date.textContent = dateFormat.format(new Date(value));
    return date;
}

function renderLoanDate(label, value) {
    const details = document.createElement("p");
    details.append(label, renderDate(value));
    return details;
}

function renderAdjustment(adjustment) {
    const entry = document.createElement("li");
    const reason = document.createElement("strong");
    reason.textContent = adjustment.reason;
    const details = document.createElement("p");
    const actor =
        adjustment.actorId === null ? "Responsável indisponível" : `Conta #${adjustment.actorId}`;
    details.append(renderDate(adjustment.createdAt), ` · ${actor}`);
    const quantities = document.createElement("p");
    quantities.textContent = `Total ${adjustment.previousTotal} → ${adjustment.newTotal} · Disponível ${adjustment.previousAvailable} → ${adjustment.newAvailable}`;
    entry.append(reason, details, quantities);
    return entry;
}

function renderLoan(loan, confirmLoanChange, openRenewal, showClient) {
    const entry = document.createElement("li");
    const identifier = document.createElement("strong");
    const loanLabel = `Empréstimo #${loan.id}`;
    identifier.textContent = loan.item ? `${loan.item.name} · ${loanLabel}` : loanLabel;
    entry.append(identifier);
    if (loan.item) {
        const itemDetails = document.createElement("p");
        const itemId = `Item #${loan.itemId}`;
        itemDetails.textContent = loan.item.location ? `${loan.item.location} · ${itemId}` : itemId;
        entry.append(itemDetails);
    }
    const details = document.createElement("p");
    const clientId = `Cliente #${loan.clientId}`;
    const client = loan.client?.name ? `${loan.client.name} (${clientId})` : clientId;
    const closed = loan.returnDate || loan.cancelledAt;
    const quantity = `${loan.loanQuantity} ${loan.loanQuantity === 1 ? "unidade" : "unidades"}`;
    details.textContent = `${showClient ? `${client} · ` : ""}${quantity}${closed ? "" : " · Ativo"}`;
    entry.append(details, renderLoanDate("Prazo de devolução ", loan.dueDate));
    if (loan.returnDate) entry.append(renderLoanDate("Devolvido em ", loan.returnDate));
    if (loan.cancelledAt) entry.append(renderLoanDate("Cancelado em ", loan.cancelledAt));
    if (closed) return entry;

    const returnButton = document.createElement("button");
    returnButton.type = "button";
    returnButton.className = "secondary";
    returnButton.textContent = "Registrar devolução";
    returnButton.setAttribute("aria-label", `Registrar devolução do empréstimo #${loan.id}`);
    returnButton.addEventListener("click", () => void confirmLoanChange(loan, "return"));
    const renewButton = document.createElement("button");
    renewButton.type = "button";
    renewButton.className = "secondary";
    renewButton.textContent = "Prorrogar prazo";
    renewButton.setAttribute("aria-label", `Prorrogar prazo do empréstimo #${loan.id}`);
    renewButton.addEventListener("click", () => openRenewal(loan, renewButton));
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "secondary";
    cancelButton.hidden = true;
    cancelButton.dataset.cancelLoan = "";
    cancelButton.textContent = "Cancelar empréstimo";
    cancelButton.setAttribute("aria-label", `Cancelar empréstimo #${loan.id}`);
    cancelButton.addEventListener("click", () => void confirmLoanChange(loan, "cancel"));
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    actions.append(renewButton, returnButton, cancelButton);
    entry.append(actions);
    return entry;
}

export function createItemRecords(
    dialog,
    fetchRecords,
    { returnLoan, renewLoan, cancelLoan, fallbackFocus },
) {
    let active = null;
    let page = 1;
    let hasNext = false;
    let loading = null;
    let savingLoan = false;
    let cancellationAllowed = false;

    function updateControls() {
        const focused = document.activeElement;
        const busy = loading !== null || savingLoan;
        previous.disabled = page === 1;
        next.disabled = !hasNext;
        for (const button of [previous, next, ...entries.querySelectorAll("button")]) {
            button.setAttribute("aria-disabled", String(busy || button.disabled));
            if (button.hasAttribute("data-cancel-loan")) button.hidden = !cancellationAllowed;
        }
        closeButton.setAttribute("aria-disabled", String(savingLoan));
        loanStatusField.disabled = savingLoan;
        region.setAttribute("aria-busy", String(busy));
        pageLabel.textContent = `Página ${page}`;
        if ((focused === previous || focused === next) && focused.disabled) pageLabel.focus();
        if (dialog.open && focused?.hasAttribute("data-cancel-loan") && focused.hidden) {
            closeButton.focus();
        }
    }

    function clearEntries() {
        if (
            dialog.open &&
            (pagination.contains(document.activeElement) || region.contains(document.activeElement))
        ) {
            closeButton.focus();
        }
        entries.replaceChildren();
        region.hidden = true;
        pagination.hidden = true;
        hasNext = false;
    }

    async function loadPage(requestedPage) {
        if (!active || loading || savingLoan) return;
        const { client, kind } = active;
        const view = views[kind];
        const loanStatus = kind === "loans" ? loanStatusField.value : null;
        const controller = new AbortController();
        loading = controller;
        updateControls();
        status.textContent = view.loading;
        try {
            const records = await fetchRecords(active, {
                page: requestedPage,
                pageSize,
                loanStatus,
                signal: controller.signal,
            });
            if (loading !== controller || !dialog.open) return;
            if (records.length === 0 && requestedPage > page) {
                hasNext = false;
                status.textContent = view.end;
                return;
            }
            page = requestedPage;
            hasNext = records.length === pageSize;
            const focusedEntry = entries.contains(document.activeElement);
            entries.replaceChildren(
                ...records.map((record) =>
                    view.render(record, confirmLoanChange, openRenewal, !client),
                ),
            );
            region.hidden = records.length === 0;
            region.scrollTop = 0;
            if (focusedEntry) (region.hidden ? closeButton : region).focus({ preventScroll: true });
            pagination.hidden = page === 1 && !hasNext;
            const emptyFirstPage = loanStatus ? emptyLoanMessages[loanStatus] : view.empty;
            const emptyMessage = page === 1 ? emptyFirstPage : "Nenhum registro nesta página.";
            status.textContent = records.length
                ? `${records.length} ${records.length === 1 ? view.singular : view.plural} nesta página.`
                : emptyMessage;
        } catch (error) {
            if (loading !== controller || !dialog.open) return;
            const temporaryFailure = !error.status || error.status >= 500;
            if (requestedPage === page || !temporaryFailure) clearEntries();
            status.textContent = error.message;
        } finally {
            if (loading === controller) {
                loading = null;
                updateControls();
            }
        }
    }

    function openRenewal(loan, opener) {
        if (active?.kind === "loans" && dialog.open && !loading && !savingLoan) {
            renewLoan(loan, opener);
        }
    }

    function refresh(message = "", requestedPage = 1) {
        if (!active || !dialog.open) return;
        result.textContent = message;
        clearEntries();
        void loadPage(requestedPage);
    }

    async function confirmLoanChange(loan, action) {
        const current = active;
        if (current?.kind !== "loans" || !dialog.open || loading || savingLoan) return;
        const cancelling = action === "cancel";
        if (cancelling && !cancellationAllowed) return;
        const quantity = `${loan.loanQuantity} ${loan.loanQuantity === 1 ? "unidade" : "unidades"}`;
        const prompt = cancelling
            ? `Cancelar o empréstimo #${loan.id} e devolver ${quantity} ao estoque?`
            : `Registrar a devolução de ${quantity} do empréstimo #${loan.id}?`;
        if (!window.confirm(prompt)) return;
        savingLoan = true;
        updateControls();
        result.textContent = cancelling ? "Cancelando empréstimo…" : "Registrando devolução…";
        let message;
        let refreshPage = 1;
        try {
            if (cancelling) {
                await cancelLoan(loan);
                message = `Empréstimo #${loan.id} cancelado.`;
            } else {
                await returnLoan(loan);
                message = `Devolução do empréstimo #${loan.id} registrada.`;
            }
        } catch (error) {
            if (error.code === "LOAN_CHANGED") refreshPage = page;
            const operation = cancelling ? "o cancelamento" : "a devolução";
            message =
                error.status >= 400 && error.status < 500
                    ? error.message
                    : `Não foi possível confirmar ${operation}. Consulte a lista antes de repetir.`;
        }
        savingLoan = false;
        if (current !== active || !dialog.open) return;
        refresh(message, refreshPage);
    }

    function clearRecords() {
        loading?.abort();
        loading = null;
        active = null;
        name.textContent = "";
        result.textContent = "";
        status.textContent = "";
        clearEntries();
    }

    previous.addEventListener("click", () => void loadPage(page - 1));
    next.addEventListener("click", () => void loadPage(page + 1));
    loanStatusField.addEventListener("change", () => {
        if (savingLoan || active?.kind !== "loans" || loanFilters.hidden || !dialog.open) return;
        loading?.abort();
        loading = null;
        clearEntries();
        page = 1;
        result.textContent = "";
        void loadPage(1);
    });
    closeButton.form.addEventListener("submit", preventCloseWhileSaving);
    dialog.addEventListener("cancel", preventCloseWhileSaving);
    dialog.addEventListener("close", () => {
        if (dialog.open) return;
        if (active?.opener.hidden) fallbackFocus.focus();
        clearRecords();
    });

    function preventCloseWhileSaving(event) {
        if (savingLoan) event.preventDefault();
    }

    return {
        refresh,
        setCancellationAllowed(allowed) {
            if (allowed === cancellationAllowed) return;
            cancellationAllowed = allowed;
            updateControls();
        },
        open({ item, client, kind = "loans", opener }) {
            if (dialog.open) return;
            clearRecords();
            active = { item, client, kind, opener };
            const view = views[kind];
            let heading = view.title;
            let closeLabel = "Voltar ao item";
            let paginationLabel = view.pagination;
            const deadlines = !item && !client;
            if (client) {
                heading = "Empréstimos do cliente";
                closeLabel = "Voltar à busca";
                paginationLabel = "Páginas dos empréstimos do cliente";
            } else if (deadlines) {
                heading = "Prazos de empréstimos";
                closeLabel = "Voltar ao estoque";
                paginationLabel = "Páginas dos prazos de empréstimos";
            }
            title.textContent = heading;
            closeButton.textContent = closeLabel;
            loanFilters.hidden = kind !== "loans";
            loanStatusField.replaceChildren(...(deadlines ? deadlineOptions : loanStatusOptions));
            loanStatusField.value = deadlines ? "overdue" : "active";
            region.setAttribute("aria-label", view.region);
            pagination.setAttribute("aria-label", paginationLabel);
            name.hidden = !(item || client);
            name.textContent = client ? `${client.name} (${client.email})` : (item?.name ?? "");
            page = 1;
            opener.focus({ preventScroll: true });
            dialog.showModal();
            void loadPage(1);
        },
        close() {
            dialog.close();
            clearRecords();
        },
    };
}
