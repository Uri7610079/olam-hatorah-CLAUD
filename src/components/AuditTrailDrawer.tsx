import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  detail?: ReactNode;
}

interface AuditTrailDrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  entries: AuditEntry[];
  loading?: boolean;
}

// מגירה גולשת המציגה יומן פעילות (audit_log) לרשומה נתונה. תתחבר לשאילתת audit_events
// אמיתית משלב 2 ואילך — כאן היא רק שלד תצוגה גנרי, ללא שליפת נתונים.
export function AuditTrailDrawer({ open, onClose, title = "יומן פעילות", entries, loading }: AuditTrailDrawerProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="סגור" className="flex-1 bg-slate-900/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="h-full w-full max-w-sm overflow-y-auto bg-white p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} aria-label="סגור" className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100">
            ✕
          </button>
        </div>
        {loading ? (
          <LoadingState rows={5} />
        ) : entries.length === 0 ? (
          <EmptyState title="אין רשומות ביומן" />
        ) : (
          <ol className="space-y-3">
            {entries.map((entry) => (
              <li key={entry.id} className="border-b border-slate-100 pb-3 text-sm">
                <p className="tabular text-xs text-slate-400">{entry.timestamp}</p>
                <p className="mt-0.5 text-slate-800">
                  <span className="font-medium">{entry.actor}</span> — {entry.action}
                </p>
                {entry.detail && <div className="mt-1 text-slate-500">{entry.detail}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
