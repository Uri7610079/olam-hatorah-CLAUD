import type { ReactNode } from "react";

interface AuthLayoutProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function AuthLayout({ title, description, children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-4">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-1 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            עת
          </span>
          <h1 className="text-lg font-bold text-slate-900">עולם התורה</h1>
        </div>
        <h2 className="mt-5 text-base font-semibold text-slate-800">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
