import type { ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "אשר",
  cancelLabel = "בטל",
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg">
        <h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-900">
          {title}
        </h2>
        {description && <div className="mt-2 text-sm text-slate-600">{description}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary px-3 py-1.5 text-sm">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} className={danger ? "btn-danger px-3 py-1.5 text-sm" : "btn-primary px-3 py-1.5 text-sm"}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
