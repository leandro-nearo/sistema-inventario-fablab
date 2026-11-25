import { clientSearchPageSize, clientSearchPath } from "./client-search.js";

export function createClientLoanSearch(dialog, request, showLoans) {
    const queryForm = dialog.querySelector("#client-loan-query-form");
    const query = dialog.querySelector("#client-loan-query");
    const searchButton = queryForm.querySelector("button");
    const status = dialog.querySelector("#client-loan-search-status");
    const selection = dialog.querySelector("#client-loan-selection");
    const clientField = dialog.querySelector("#client-loan-client");
    const consult = selection.querySelector("button");
    let matches = [];
    let searching = null;

    function clearResults() {
        searching?.abort();
        searching = null;
        matches = [];
        selection.hidden = true;
        consult.disabled = true;
        clientField.replaceChildren();
        status.textContent = "";
        searchButton.removeAttribute("aria-disabled");
    }

    function resetSearch() {
        queryForm.reset();
        clearResults();
    }

    query.addEventListener("input", clearResults);
    queryForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!dialog.open || searching) return;
        clearResults();
        const controller = new AbortController();
        searching = controller;
        searchButton.setAttribute("aria-disabled", "true");
        status.textContent = "Buscando clientes…";
        try {
            const clients = await request(clientSearchPath(query.value), {
                signal: controller.signal,
            });
            if (searching !== controller || !dialog.open) return;
            matches = clients;
            if (clients.length === 0) {
                status.textContent = "Nenhum cliente encontrado.";
                return;
            }
            clientField.replaceChildren(
                new Option("Selecione um cliente", ""),
                ...clients.map(({ id, name, email }) => new Option(`${name} (${email})`, id)),
            );
            selection.hidden = false;
            status.textContent =
                clients.length === clientSearchPageSize
                    ? "20 resultados exibidos. Refine a busca se necessário."
                    : clients.length === 1
                      ? "1 cliente encontrado."
                      : `${clients.length} clientes encontrados.`;
        } catch (error) {
            if (searching === controller && dialog.open) status.textContent = error.message;
        } finally {
            if (searching === controller) {
                searching = null;
                searchButton.removeAttribute("aria-disabled");
            }
        }
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
