export const clientSearchPageSize = 20;

export function clientSearchPath(value, page = 1) {
    const search = value.trim();
    if (!search) throw new Error("Informe o nome ou e-mail do cliente.");

    const exactEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(search);
    if (search.length > 100 && !exactEmail) {
        throw new Error("Informe até 100 caracteres ou um e-mail completo.");
    }
    const params = new URLSearchParams(
        exactEmail ? { email: search, pageSize: 1 } : { search, pageSize: clientSearchPageSize },
    );
    if (page > 1) params.set("page", page);
    return `/client?${params}`;
}
