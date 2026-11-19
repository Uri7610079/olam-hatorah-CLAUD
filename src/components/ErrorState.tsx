import { CircleAlert } from "lucide-react";

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

// v3: אייקון לצד ההודעה ויישור לימין (קל יותר לקרוא הודעה ארוכה), מסגרת עדינה.
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="rounded-card border border-danger bg-danger-soft px-5 py-4 text-center v3:border-danger/40 v3:px-4 v3:py-3 v3:text-right">
      <p className="text-sm font-medium text-danger-ink v3:flex v3:items-start v3:gap-2">
        <CircleAlert className="mt-0.5 hidden h-4 w-4 shrink-0 v3:inline" aria-hidden="true" />
        <span>{message}</span>
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-control border border-danger bg-surface px-3 py-1.5 text-sm text-danger-ink shadow-sm transition hover:bg-danger-soft"
        >
          נסה שוב
        </button>
      )}
    </div>
  );
}
