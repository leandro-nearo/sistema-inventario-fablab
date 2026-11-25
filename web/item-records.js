const closeButton = document.querySelector("#close-item-records");
const title = document.querySelector("#records-title");
const name = document.querySelector("#records-item");
const status = document.querySelector("#records-status");
const region = document.querySelector("#records-region");
const entries = document.querySelector("#records-entries");
const pagination = document.querySelector("#records-pagination");
const previous = document.querySelector("#records-previous");
const next = document.querySelector("#records-next");
const pageLabel = document.querySelector("#records-page");

const pageSize = 10;
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
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
        title: "Empréstimos ativos",
        region: "Registros de empréstimo",
        pagination: "Páginas dos empréstimos ativos",
        loading: "Carregando empréstimos…",
        empty: "Nenhum empréstimo ativo.",
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

function renderLoan(loan) {
    const entry = document.createElement("li");
    const identifier = document.createElement("strong");
    identifier.textContent = `Empréstimo #${loan.id}`;
    const details = document.createElement("p");
    const clientId = `Cliente #${loan.clientId}`;
    const client = loan.client?.name ? `${loan.client.name} (${clientId})` : clientId;
    details.textContent = `${client} · ${loan.loanQuantity} ${loan.loanQuantity === 1 ? "unidade" : "unidades"}`;
    const due = document.createElement("p");
    due.append("Prazo de devolução ", renderDate(loan.dueDate));
    entry.append(identifier, details, due);
    return entry;
}

export function createItemRecords(dialog, fetchRecords, fallbackFocus) {
    let active = null;
    let page = 1;
    let hasNext = false;
    let loading = null;

    function updateControls() {
        const focused = document.activeElement;
        const busy = loading !== null;
        previous.disabled = page === 1;
        next.disabled = !hasNext;
        for (const button of [previous, next]) {
            button.setAttribute("aria-disabled", String(busy || button.disabled));
        }
        region.setAttribute("aria-busy", String(busy));
        pageLabel.textContent = `Página ${page}`;
        if ((focused === previous || focused === next) && focused.disabled) pageLabel.focus();
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
        if (!active || loading) return;
        const { item, kind } = active;
        const view = views[kind];
        const controller = new AbortController();
        loading = controller;
        updateControls();
        status.textContent = view.loading;
        try {
            const records = await fetchRecords(
                kind,
                item.id,
                requestedPage,
                pageSize,
                controller.signal,
            );
            if (loading !== controller || !dialog.open) return;
            if (records.length === 0 && requestedPage > page) {
                hasNext = false;
                status.textContent = view.end;
                return;
            }
            page = requestedPage;
            hasNext = records.length === pageSize;
            entries.replaceChildren(...records.map(view.render));
            region.hidden = records.length === 0;
            region.scrollTop = 0;
            pagination.hidden = page === 1 && !hasNext;
            const emptyMessage = page === 1 ? view.empty : "Nenhum registro nesta página.";
            status.textContent = records.length
                ? `${records.length} ${records.length === 1 ? view.singular : view.plural} nesta página.`
                : emptyMessage;
        } catch (error) {
            if (loading !== controller || !dialog.open) return;
            clearEntries();
            status.textContent = error.message;
        } finally {
            if (loading === controller) {
                loading = null;
                updateControls();
            }
        }
    }

    function clearRecords() {
        loading?.abort();
        loading = null;
        active = null;
        name.textContent = "";
        status.textContent = "";
        clearEntries();
    }

    previous.addEventListener("click", () => void loadPage(page - 1));
    next.addEventListener("click", () => void loadPage(page + 1));
    dialog.addEventListener("close", () => {
        if (dialog.open) return;
        if (active?.opener.hidden) fallbackFocus.focus();
        clearRecords();
    });

    return {
        open(item, kind, opener) {
            if (dialog.open) return;
            clearRecords();
            active = { item, kind, opener };
            const view = views[kind];
            title.textContent = view.title;
            region.setAttribute("aria-label", view.region);
            pagination.setAttribute("aria-label", view.pagination);
            name.textContent = item.name;
            page = 1;
            dialog.showModal();
            void loadPage(1);
        },
        close() {
            dialog.close();
            clearRecords();
        },
    };
}
