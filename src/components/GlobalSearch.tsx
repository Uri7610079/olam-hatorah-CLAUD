import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface SearchResult {
  kind: "student" | "group" | "branch" | "organization";
  id: string;
  label: string;
  sublabel?: string;
  href: string;
}

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  student: "תלמיד",
  group: "קבוצה",
  branch: "סניף",
  organization: "עמותה",
};

async function search(term: string): Promise<SearchResult[]> {
  const like = `%${term}%`;
  const [students, groups, branches, orgs] = await Promise.all([
    supabase.from("students").select("id, external_id, full_name").or(`full_name.ilike.${like},external_id.ilike.${like}`).limit(5),
    supabase.from("groups").select("id, name").ilike("name", like).limit(5),
    supabase.from("branches").select("id, internal_name").ilike("internal_name", like).limit(5),
    supabase.from("organizations").select("id, legal_name").ilike("legal_name", like).limit(5),
  ]);

  const results: SearchResult[] = [];
  for (const s of students.data ?? []) results.push({ kind: "student", id: s.id, label: s.full_name, sublabel: s.external_id, href: `/ops/students/${s.id}` });
  for (const g of groups.data ?? []) results.push({ kind: "group", id: g.id, label: g.name, href: "/ops/branches-groups" });
  for (const b of branches.data ?? []) results.push({ kind: "branch", id: b.id, label: b.internal_name, href: "/ops/branches-groups" });
  for (const o of orgs.data ?? []) results.push({ kind: "organization", id: o.id, label: o.legal_name, href: `/ops/organizations/${o.id}` });
  return results;
}

// חיפוש גלובלי אמיתי: תלמיד/קבוצה/סניף/עמותה (RLS כבר מגביל לכל משתמש את מה שהוא
// רואה ממילא - אין כאן בדיקת הרשאה נוספת). קבוצה/סניף מקשרים למסך סניפים-וקבוצות
// הכללי (אין עדיין deep-link לקבוצה/סניף ספציפיים), תלמיד/עמותה מקשרים ישירות לכרטיס.
export function GlobalSearch() {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      search(term.trim()).then((r) => {
        setResults(r);
        setOpen(true);
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [term]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative mx-2 hidden w-80 sm:block">
      <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="חיפוש גלובלי: תלמיד, קבוצה, סניף, עמותה…"
        aria-label="חיפוש גלובלי"
        className="input-field pr-9"
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {results.map((r) => (
            <button
              key={`${r.kind}-${r.id}`}
              onClick={() => {
                navigate(r.href);
                setOpen(false);
                setTerm("");
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-right text-sm hover:bg-slate-50"
            >
              <span>
                {r.label}
                {r.sublabel && <span className="text-slate-400"> · {r.sublabel}</span>}
              </span>
              <span className="text-xs text-slate-400">{KIND_LABEL[r.kind]}</span>
            </button>
          ))}
        </div>
      )}
      {open && term.trim().length >= 2 && results.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500 shadow-lg">אין תוצאות</div>
      )}
    </div>
  );
}
