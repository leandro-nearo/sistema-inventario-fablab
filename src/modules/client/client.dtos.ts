import type { Pagination } from "@src/shared/validation/fields.js";

export type ClientDTO = {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    createdAt: Date;
    updatedAt: Date;
};

export type ClientListOptions = Pagination & { search?: string; email?: string };

export type CreateClientDTO = {
    name: string;
    email: string;
    phone?: string | null;
};

export type UpdateClientDTO = {
    name?: string;
    email?: string;
    phone?: string | null;
};
