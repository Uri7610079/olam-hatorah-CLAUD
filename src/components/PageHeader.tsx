import type { ReactNode } from "react";
import { Breadcrumbs, type BreadcrumbItem } from "./Breadcrumbs";

interface PageHeaderProps {
  title: string;
  description?: string;
  primaryAction?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
}

export function PageHeader({ title, description, primaryAction, breadcrumbs }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-2 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-slate-500">{description}</p>}
      </div>
      {primaryAction && <div>{primaryAction}</div>}
    </div>
  );
}
