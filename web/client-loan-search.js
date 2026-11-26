import { clientSearchPageSize, clientSearchPath } from "./client-search.js";

export function createClientLoanSearch(dialog, request, showLoans) {
    const queryForm = dialog.querySelector("#client-loan-query-form");
    const query = dialog.querySelector("#client-loan-query");
    const searchButton = queryForm.querySelector("button");
    const status = dialog.querySelector("#client-loan-search-status");
    const selection = dialog.querySelector("#client-loan-selection");
    const clientField = dialog.querySelector("#client-loan-client");
    const more = selection.querySelector("#client-loan-more");
    const consult = selection.querySelector('button[type="submit"]');
    let matches = [];
    let page = 0;
    let searching = null;

    function clearResults() {
        searching?.abort();
        searching = null;
        matches = [];
        page = 0;
        selection.hidden = true;
        more.hidden = true;
        consult.disabled = true;
        clientField.replaceChildren();
        status.textContent = "";
        searchButton.removeAttribute("aria-disabled");
        more.removeAttribute("aria-disabled");
    }

    function resetSearch() {
        queryForm.reset();
        clearResults();
    }

    async function loadPage(requestedPage) {
        if (!dialog.open || searching) return;
        const controller = new AbortController();
        searching = controller;
        searchButton.setAttribute("aria-disabled", "true");
        more.setAttribute("aria-disabled", "true");
        status.textContent = "Buscando clientes…";
        try {
            const { records: clients, hasNext } = await request(
                clientSearchPath(query.value, requestedPage),
                {
                    signal: controller.signal,
                    withPageInfo: true,
                },
            );
            if (searching !== controller || !dialog.open) return;
            if (requestedPage === 1 && clients.length > 0) {
                clientField.append(new Option("Selecione um cliente", ""));
            }
            page = requestedPage;
            matches.push(...clients);
            if (matches.length === 0) {
                status.textContent = "Nenhum cliente encontrado.";
                return;
            }
            clientField.append(
                ...clients.map(({ id, name, email }) => new Option(`${name} (${email})`, id)),
            );
            selection.hidden = false;
            const hasMore = hasNext ?? clients.length === clientSearchPageSize;
            if (!hasMore && document.activeElement === more) clientField.focus();
            more.hidden = !hasMore;
            status.textContent =
                matches.length === 1
                    ? "1 cliente exibido."
                    : `${matches.length} clientes exibidos.`;
        } catch (error) {
            if (searching === controller && dialog.open) status.textContent = error.message;
        } finally {
            if (searching === controller) {
                searching = null;
                searchButton.removeAttribute("aria-disabled");
                more.removeAttribute("aria-disabled");
            }
        }
    }

    query.addEventListener("input", clearResults);
    queryForm.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!dialog.open || searching) return;
        clearResults();
        void loadPage(1);
    });
    more.addEventListener("click", () => {
        if (!more.hidden) void loadPage(page + 1);
    });
    clientField.addEventListener("change", () => {
        consult.disabled = !clientField.value;
    });
    selection.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!dialog.open) return;
        const client = matches.find(({ id }) => String(id) === clientField.value);
        if (client) showLoans(client, consult);
    });
    dialog.addEventListener("close", () => {
        if (!dialog.open) resetSearch();
    });

    return {
        open(opener) {
            if (dialog.open) return;
            resetSearch();
            opener.focus({ preventScroll: true });
            dialog.showModal();
            query.focus();
        },
        close() {
            dialog.close();
            resetSearch();
        },
    };
}
