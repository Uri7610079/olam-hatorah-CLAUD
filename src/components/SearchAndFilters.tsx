import type { ReactNode } from "react";
import { Search } from "lucide-react";

interface SearchAndFiltersProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  advancedFilters?: ReactNode;
}

export function SearchAndFilters({
  searchValue,
  onSearchChange,
  searchPlaceholder = "חיפוש…",
  advancedFilters,
}: SearchAndFiltersProps) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative max-w-sm flex-1">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="input-field pr-9"
        />
      </div>
      {advancedFilters}
    </div>
  );
}
