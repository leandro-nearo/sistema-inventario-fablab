import type { Response } from "express";
import { type Pagination, paginationFrom } from "./validation/fields.js";

export const nextPageHeader = "X-Has-Next-Page";

export async function sendPage<T>(
    res: Response,
    query: { page: number; pageSize: number },
    fetchPage: (pagination: Pagination) => Promise<T[]>,
) {
    const { skip, take } = paginationFrom(query);
    const records = await fetchPage({ skip, take: take + 1 });
    return res.set(nextPageHeader, String(records.length > take)).json(records.slice(0, take));
}
