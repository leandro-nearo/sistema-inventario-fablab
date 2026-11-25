import { parseLocalDateTime } from "./local-date-time.js";

const dialog = document.querySelector("#loan-renewal");
const identifier = document.querySelector("#renewal-loan");
const currentDue = document.querySelector("#renewal-current");
const form = document.querySelector("#renewal-form");
const due = document.querySelector("#renewal-due");
const status = document.querySelector("#renewal-status");
const close = document.querySelector("#close-renewal");
const save = document.querySelector("#save-renewal");
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function createLoanRenewal(renew, fetchLoan, refreshRecords) {
    let active = null;
    let retainedDraft = null;

    function updateControls() {
        const { busy, closed, needsRefresh } = active;
        due.readOnly = busy || closed;
        close.setAttribute("aria-disabled", String(busy));
        save.setAttribute("aria-disabled", String(busy));
        if (closed && document.activeElement === save) close.focus();
        save.disabled = closed;
        save.formNoValidate = needsRefresh;
        save.textContent = needsRefresh ? "Consultar prazo atual" : "Salvar prazo";
    }

    function showDueDate(value) {
        currentDue.dateTime = value;
        currentDue.textContent = dateFormat.format(new Date(value));
    }

    function finish() {
        const context = active;
        active = null;
        context?.controller.abort();
        form.reset();
        status.textContent = "";
        identifier.textContent = "";
        currentDue.removeAttribute("datetime");
        currentDue.textContent = "";
        dialog.close();
        if (context?.refresh) refreshRecords(context.message);
    }

    function isOpen(context) {
        return active === context && dialog.open;
    }

    async function loadCurrent(context) {
        context.needsRefresh = true;
        status.textContent = "Consultando o prazo atual…";
        try {
            const loan = await fetchLoan(context.loan.id, context.controller.signal);
            if (!isOpen(context)) return;
            context.loan = loan;
            context.needsRefresh = false;
            context.closed = Boolean(loan.returnDate || loan.cancelledAt);
            showDueDate(loan.dueDate);
            status.textContent = context.closed
                ? "O empréstimo foi encerrado."
                : "O prazo atual foi consultado. Confira e envie novamente.";
        } catch (error) {
            if (isOpen(context)) status.textContent = error.message;
        }
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const context = active;
        if (!context || !dialog.open || context.busy || context.closed) return;
        const date = context.needsRefresh ? null : parseLocalDateTime(due.value);
        if (!context.needsRefresh && (!date || date <= new Date(context.loan.dueDate))) {
            status.textContent = date
                ? "Informe um prazo posterior ao atual."
                : "Informe um horário local válido para a devolução.";
            due.focus();
            return;
        }

        context.busy = true;
        updateControls();
        try {
            if (context.needsRefresh) {
                await loadCurrent(context);
                return;
            }
            status.textContent = "Salvando prazo…";
            context.refresh = true;
            await renew(context.loan.id, {
                expectedUpdatedAt: context.loan.updatedAt,
                dueDate: date.toISOString(),
            });
            if (!isOpen(context)) return;
            context.message = `Prazo do empréstimo #${context.loan.id} prorrogado.`;
            finish();
        } catch (error) {
            if (!isOpen(context)) return;
            if (error.code === "LOAN_CHANGED") {
                await loadCurrent(context);
                return;
            }
            context.closed = ["LOAN_RETURNED", "LOAN_CANCELLED", "LOAN_NOT_FOUND"].includes(
                error.code,
            );
            status.textContent =
                error.status >= 400 && error.status < 500
                    ? error.message
                    : "Não foi possível confirmar a prorrogação. Confira o novo prazo ou tente novamente.";
        } finally {
            context.busy = false;
            if (isOpen(context)) updateControls();
        }
    });

    close.addEventListener("click", () => {
        if (!active?.busy) finish();
    });
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        if (!active?.busy) finish();
    });

    return {
        open(loan, opener, userId) {
            if (dialog.open) return;
            active = {
                loan,
                userId,
                controller: new AbortController(),
                busy: false,
                closed: false,
                needsRefresh: false,
                refresh: false,
                message: "",
            };
            identifier.textContent = `Empréstimo #${loan.id}`;
            showDueDate(loan.dueDate);
            if (retainedDraft?.userId !== userId) retainedDraft = null;
            if (retainedDraft?.loanId === loan.id) {
                due.value = retainedDraft.due;
                retainedDraft = null;
            }
            updateControls();
            opener.focus({ preventScroll: true });
            dialog.showModal();
            due.focus();
        },
        close(preserveDraft) {
            if (!preserveDraft) retainedDraft = null;
            if (!active) return;
            if (preserveDraft && due.value) {
                retainedDraft = {
                    userId: active.userId,
                    loanId: active.loan.id,
                    due: due.value,
                };
            }
            active.refresh = false;
            finish();
        },
    };
}
