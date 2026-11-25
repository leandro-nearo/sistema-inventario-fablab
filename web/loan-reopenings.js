const pageSize = 10;
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function renderEvent(label, date, actorId) {
    const event = document.createElement("p");
    const time = document.createElement("time");
    time.dateTime = date;
    time.textContent = dateFormat.format(new Date(date));
    const actor = actorId === null ? "Conta indisponível" : `Conta #${actorId}`;
    event.append(label, time, ` · ${actor}`);
    return event;
}

function renderReopening(record) {
    const entry = document.createElement("li");
    entry.append(
        renderEvent("Reaberto em ", record.createdAt, record.actorId),
        renderEvent(
            "Devolução anterior em ",
            record.previousReturnedAt,
            record.previousReturnedById,
        ),
    );
    return entry;
}

export function createLoanReopenings(dialog, fetchReopenings, fallbackFocus) {
    const closeButton = dialog.querySelector("#close-reopenings");
    const loanLabel = dialog.querySelector("#reopenings-loan");
    const status = dialog.querySelector("#reopenings-status");
    const region = dialog.querySelector("#reopenings-region");
    const entries = dialog.querySelector("#reopenings-entries");
    const pagination = dialog.querySelector("#reopenings-pagination");
    const previous = dialog.querySelector("#reopenings-previous");
    const next = dialog.querySelector("#reopenings-next");
    const pageLabel = dialog.querySelector("#reopenings-page");
    let active = null;
    let loading = null;
    let page = 1;
    let hasNext = false;

    function updateControls() {
        const focused = document.activeElement;
        previous.disabled = page === 1;
        next.disabled = !hasNext;
        previous.setAttribute("aria-disabled", String(previous.disabled || loading !== null));
        next.setAttribute("aria-disabled", String(next.disabled || loading !== null));
        region.setAttribute("aria-busy", String(loading !== null));
        pageLabel.textContent = `Página ${page}`;
        if ((focused === previous || focused === next) && focused.disabled) pageLabel.focus();
    }

    function clearRecords() {
        loading?.abort();
        loading = null;
        page = 1;
        hasNext = false;
        const focused = document.activeElement;
        if (dialog.open && (region.contains(focused) || pagination.contains(focused))) {
            closeButton.focus();
        }
        entries.replaceChildren();
        region.hidden = true;
        pagination.hidden = true;
        loanLabel.textContent = "";
        status.textContent = "";
        updateControls();
    }

    async function loadPage(requestedPage) {
        if (!active || loading || !dialog.open) return;
        const controller = new AbortController();
        loading = controller;
        updateControls();
        status.textContent = "Carregando reaberturas…";
        try {
            const { records, hasNext: nextPage } = await fetchReopenings(active.id, {
                page: requestedPage,
                pageSize,
                signal: controller.signal,
            });
            if (loading !== controller || !dialog.open) return;
            if (records.length === 0 && requestedPage > page) {
                hasNext = false;
                status.textContent = "Você chegou ao fim do histórico.";
                return;
            }
            page = requestedPage;
            hasNext = nextPage ?? records.length === pageSize;
            entries.replaceChildren(...records.map(renderReopening));
            region.hidden = records.length === 0;
            region.scrollTop = 0;
            if (page === 1 && !hasNext && pagination.contains(document.activeElement)) {
                closeButton.focus();
            }
            pagination.hidden = page === 1 && !hasNext;
            status.textContent = records.length
                ? `${records.length} ${records.length === 1 ? "reabertura" : "reaberturas"} nesta página.`
                : "Nenhuma reabertura registrada.";
        } catch (error) {
            if (loading === controller && dialog.open) status.textContent = error.message;
        } finally {
            if (loading === controller) {
                loading = null;
                updateControls();
            }
        }
    }

    previous.addEventListener("click", () => void loadPage(page - 1));
    next.addEventListener("click", () => void loadPage(page + 1));
    dialog.addEventListener("close", () => {
        if (dialog.open) return;
        if (active && (active.opener.hidden || !active.opener.isConnected)) fallbackFocus.focus();
        active = null;
        clearRecords();
    });

    return {
        open(id, opener) {
            if (dialog.open) return;
            clearRecords();
            active = { id, opener };
            loanLabel.textContent = `Empréstimo #${id}`;
            opener.focus({ preventScroll: true });
            dialog.showModal();
            void loadPage(1);
        },
        denyAccess() {
            if (!dialog.open) return;
            clearRecords();
            status.textContent = "Acesso negado.";
        },
        close() {
            active = null;
            clearRecords();
            dialog.close();
        },
    };
}
