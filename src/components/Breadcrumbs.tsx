import { Link } from "react-router-dom";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

// הפריט האחרון תמיד ללא קישור — הוא העמוד הנוכחי (aria-current="page").
export function Breadcrumbs({ items }: BreadcrumbsProps) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="breadcrumb" className="mb-1 flex flex-wrap items-center gap-1 text-sm text-ink-subtle">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true">/</span>}
            {item.href && !isLast ? (
              <Link to={item.href} className="hover:text-ink hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "text-ink-muted" : undefined} aria-current={isLast ? "page" : undefined}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
