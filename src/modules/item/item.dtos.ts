import type { Pagination } from "@src/shared/validation/fields.js";

export type ItemDTO = {
    id: number;
    name: string;
    category: string | null;
    totalQuantity: number;
    availableQuantity: number;
    location: string;
    createdAt: Date;
    updatedAt: Date;
};

export type CreateItemDTO = {
    name: string;
    category?: string | null;
    totalQuantity: number;
    location: string;
};

export type UpdateItemDTO = {
    name?: string;
    category?: string | null;
    totalQuantity?: number;
    expectedTotalQuantity?: number;
    location?: string;
    adjustmentReason?: string;
};

export type ItemListOptions = Pagination & {
    search?: string;
    availability?: "available" | "unavailable";
    order?: "asc" | "desc";
};

export type ListByCategoryDTO = {
    category: string;
};
export type ListByLocationDTO = {
    location: string;
};
