const dialog = document.querySelector("#adjustment-history");
const closeButton = document.querySelector("#close-adjustment-history");
const name = document.querySelector("#history-item");
const status = document.querySelector("#history-status");
const region = document.querySelector("#history-region");
const entries = document.querySelector("#history-entries");
const pagination = document.querySelector("#history-pagination");
const previous = document.querySelector("#history-previous");
const next = document.querySelector("#history-next");
const pageLabel = document.querySelector("#history-page");

const pageSize = 10;
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function renderAdjustment(adjustment) {
    const entry = document.createElement("li");
    const reason = document.createElement("strong");
    reason.textContent = adjustment.reason;
    const details = document.createElement("p");
    const date = document.createElement("time");
    date.dateTime = adjustment.createdAt;
    date.textContent = dateFormat.format(new Date(adjustment.createdAt));
    const actor =
        adjustment.actorId === null ? "Responsável indisponível" : `Conta #${adjustment.actorId}`;
    details.append(date, ` · ${actor}`);
    const quantities = document.createElement("p");
    quantities.textContent = `Total ${adjustment.previousTotal} → ${adjustment.newTotal} · Disponível ${adjustment.previousAvailable} → ${adjustment.newAvailable}`;
    entry.append(reason, details, quantities);
    return entry;
}

export function createAdjustmentHistory(fetchAdjustments) {
    let activeItem = null;
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
        const item = activeItem;
        if (!item || loading) return;
        const controller = new AbortController();
        loading = controller;
        updateControls();
        status.textContent = "Carregando ajustes…";
        try {
            const records = await fetchAdjustments(
                item.id,
                requestedPage,
                pageSize,
                controller.signal,
            );
            if (loading !== controller || !dialog.open) return;
            if (records.length === 0 && requestedPage > page) {
                hasNext = false;
                status.textContent = "Você chegou ao fim do histórico.";
                return;
            }
            page = requestedPage;
            hasNext = records.length === pageSize;
            entries.replaceChildren(...records.map(renderAdjustment));
            region.hidden = records.length === 0;
            region.scrollTop = 0;
            pagination.hidden = page === 1 && !hasNext;
            status.textContent = records.length
                ? `${records.length} ${records.length === 1 ? "ajuste nesta página" : "ajustes nesta página"}.`
                : "Nenhum ajuste registrado.";
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

    function clearHistory() {
        loading?.abort();
        loading = null;
        activeItem = null;
        name.textContent = "";
        status.textContent = "";
        clearEntries();
    }

    previous.addEventListener("click", () => void loadPage(page - 1));
    next.addEventListener("click", () => void loadPage(page + 1));
    dialog.addEventListener("close", () => {
        if (!dialog.open) clearHistory();
    });

    return {
        open(item) {
            if (dialog.open) return;
            clearHistory();
            activeItem = item;
            name.textContent = item.name;
            page = 1;
            dialog.showModal();
            void loadPage(1);
        },
        close() {
            dialog.close();
            clearHistory();
        },
    };
}
