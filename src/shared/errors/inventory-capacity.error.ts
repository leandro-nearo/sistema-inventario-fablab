export class InventoryCapacityError extends Error {
    constructor(readonly borrowedQuantity: number) {
        super("Total quantity is lower than the borrowed quantity");
        this.name = "InventoryCapacityError";
    }
}

export class InventoryInvariantError extends Error {
    constructor() {
        super("Inventory quantities are inconsistent");
        this.name = "InventoryInvariantError";
    }
}

export class InventoryQuantityChangedError extends Error {
    constructor() {
        super("The total quantity changed");
        this.name = "InventoryQuantityChangedError";
    }
}

export class InventoryFieldsChangedError extends Error {
    constructor() {
        super("One or more item fields changed");
        this.name = "InventoryFieldsChangedError";
    }
}
