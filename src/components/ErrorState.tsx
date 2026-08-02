interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="rounded-card border border-danger bg-danger-soft px-5 py-4 text-center">
      <p className="text-sm font-medium text-danger-ink">{message}</p>
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
