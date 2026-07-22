import type { ReactNode } from "react";

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
      <input
        type="search"
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        className="input-field max-w-sm"
      />
      {advancedFilters}
    </div>
  );
}
