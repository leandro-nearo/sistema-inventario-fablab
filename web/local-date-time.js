export function parseLocalDateTime(value) {
    const date = new Date(value);
    const localTime = date.getTime() - date.getTimezoneOffset() * 60_000;
    if (!Number.isFinite(localTime) || new Date(localTime).toISOString().slice(0, 16) !== value) {
        return null;
    }
    return date;
}
