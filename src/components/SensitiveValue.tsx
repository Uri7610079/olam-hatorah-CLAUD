import { useState } from "react";

interface SensitiveValueProps {
  masked: string;
  canReveal: boolean;
  onReveal?: () => Promise<string>;
}

// חובה: הערך המלא לעולם לא נשלח ל-DOM ומוסתר ב-CSS. חשיפה היא בקשת שרת נפרדת
// (onReveal) שנרשמת ביומן הפעילות בצד השרת — ר' ARCHITECTURE.md.
export function SensitiveValue({ masked, canReveal, onReveal }: SensitiveValueProps) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!canReveal) {
    return <span className="tabular ltr-num text-ink-subtle">{masked}</span>;
  }

  if (revealed) {
    return <span className="tabular ltr-num font-medium">{revealed}</span>;
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular ltr-num text-ink-subtle">{masked}</span>
      <button
        type="button"
        disabled={loading}
        onClick={async () => {
          if (!onReveal) return;
          setLoading(true);
          try {
            setRevealed(await onReveal());
          } finally {
            setLoading(false);
          }
        }}
        className="link-action text-xs disabled:opacity-50"
      >
        {loading ? "חושף…" : "חשוף"}
      </button>
    </span>
  );
}
