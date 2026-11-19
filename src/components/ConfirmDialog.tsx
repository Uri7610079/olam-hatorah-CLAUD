import { useEffect, useId, useRef, type ReactNode } from "react";
import { useEscapeToClose } from "@/lib/useEscapeToClose";

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

// נגישות: הפוקוס עובר לחלון כשהוא נפתח (לכפתור הביטול - הבחירה הבטוחה), Tab
// נשאר בתוך החלון, ובסגירה הפוקוס חוזר למקום שממנו נפתח. מזהה הכותרת ייחודי
// לכל חלון (עד היום כל החלונות חלקו מזהה אחד).
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
  useEscapeToClose(open, onCancel);
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => prev?.focus?.();
  }, [open]);

  if (!open) return null;

  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !boxRef.current) return;
    const items = boxRef.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea");
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={trapTab}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
    >
      <div ref={boxRef} className="w-full max-w-sm rounded-card bg-surface p-5 shadow-lg v3:max-w-md">
        <h2 id={titleId} className="text-base font-semibold text-ink v3:text-primary">
          {title}
        </h2>
        {description && <div className="mt-2 text-sm text-ink-muted">{description}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} onClick={onCancel} className="btn-secondary px-3 py-1.5 text-sm">
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
