import type { ReactNode } from "react";

interface MatchSplitViewProps<TSource, TTarget> {
  sourceTitle: string;
  targetTitle: string;
  sources: TSource[];
  targets: TTarget[];
  renderSource: (item: TSource) => ReactNode;
  renderTarget: (item: TTarget) => ReactNode;
  sourceKey: (item: TSource) => string;
  targetKey: (item: TTarget) => string;
  selectedSourceKey?: string;
  onSelectSource?: (item: TSource) => void;
  selectedTargetKeys?: string[];
  onToggleTarget?: (item: TTarget) => void;
}

// תצוגת התאמה דו-צדדית (שלב 12): צד אחד = תנועת בנק מקור, צד שני = יעדים עסקיים מועמדים
// (מס"ב/תרומה/עמלה וכו'). תומך גם בבחירת יעד יחיד וגם במספר יעדים (one-to-many) דרך onToggleTarget.
export function MatchSplitView<TSource, TTarget>({
  sourceTitle,
  targetTitle,
  sources,
  targets,
  renderSource,
  renderTarget,
  sourceKey,
  targetKey,
  selectedSourceKey,
  onSelectSource,
  selectedTargetKeys = [],
  onToggleTarget,
}: MatchSplitViewProps<TSource, TTarget>) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="card">
        <h3 className="border-b border-line px-4 py-2.5 text-sm font-semibold text-ink-muted">
          {sourceTitle}
        </h3>
        <ul className="divide-y divide-line">
          {sources.map((item) => {
            const key = sourceKey(item);
            const selected = key === selectedSourceKey;
            return (
              <li key={key}>
                <button
                  onClick={() => onSelectSource?.(item)}
                  aria-pressed={selected}
                  className={`w-full px-4 py-2.5 text-right text-sm transition ${
                    selected ? "bg-brand-50" : "hover:bg-surface-muted"
                  }`}
                >
                  {renderSource(item)}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="card">
        <h3 className="border-b border-line px-4 py-2.5 text-sm font-semibold text-ink-muted">
          {targetTitle}
        </h3>
        <ul className="divide-y divide-line">
          {targets.map((item) => {
            const key = targetKey(item);
            const selected = selectedTargetKeys.includes(key);
            return (
              <li key={key}>
                <button
                  onClick={() => onToggleTarget?.(item)}
                  aria-pressed={selected}
                  className={`w-full px-4 py-2.5 text-right text-sm transition ${
                    selected ? "bg-brand-50" : "hover:bg-surface-muted"
                  }`}
                >
                  {renderTarget(item)}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
