import type { ReactNode } from "react";

interface AuthLayoutProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function AuthLayout({ title, description, children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-1 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-control bg-brand-600 text-sm font-bold text-white">
            עת
          </span>
          <h1 className="text-lg font-bold text-ink">עולם התורה</h1>
        </div>
        <h2 className="mt-5 text-base font-semibold text-ink">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-subtle">{description}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
