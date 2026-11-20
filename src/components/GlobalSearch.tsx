import { groupLabel } from "@/lib/groupLabel";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface SearchResult {
  kind: "student" | "group" | "branch" | "organization" | "task";
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
  task: "משימה",
};

async function search(term: string): Promise<SearchResult[]> {
  // פסיק וסוגריים שוברים את תחביר ה-or של PostgREST ("full_name.ilike...,external_id...") -
  // מסירים אותם מהמונח. % ו-_ הם תווים כלליים של ilike, ונשארים כמו קודם.
  const like = `%${term.replace(/[,()]/g, " ").trim()}%`;
  const [students, groups, branches, orgs, tasks] = await Promise.all([
    supabase.from("students").select("id, external_id, full_name").or(`full_name.ilike.${like},external_id.ilike.${like}`).limit(5),
    supabase.from("groups").select("id, name, branch_id, branch:branches(organization_id, internal_name, talmud_branch_code, organization:organizations(legal_name))").ilike("name", like).limit(5),
    supabase.from("branches").select("id, internal_name, organization_id").ilike("internal_name", like).limit(5),
    supabase.from("organizations").select("id, legal_name").ilike("legal_name", like).limit(5),
    supabase.from("tasks").select("id, title").ilike("title", like).limit(5),
  ]);

  // כל החיפושים נכשלו (בעיית רשת, למשל) - שגיאה, ולא "אין תוצאות" שמטעה
  if ([students, groups, branches, orgs, tasks].every((r) => r.error)) throw new Error("search failed");

  const results: SearchResult[] = [];
  for (const s of students.data ?? []) results.push({ kind: "student", id: s.id, label: s.full_name, sublabel: s.external_id, href: `/ops/students/${s.id}` });
  // קבוצה: עם הסניף והעמותה (כמה קבוצות באותו שם), והקישור פותח את הסניף ומדגיש את
  // הקבוצה עצמה - לא רק את העמותה (INT-03, INT-05).
  for (const g of groups.data ?? []) {
    const branch: any = Array.isArray(g.branch) ? g.branch[0] : g.branch;
    const org: any = branch ? (Array.isArray(branch.organization) ? branch.organization[0] : branch.organization) : null;
    const orgId = branch?.organization_id;
    results.push({
      kind: "group",
      id: g.id,
      label: groupLabel(g.name, branch),
      sublabel: org?.legal_name ?? undefined,
      href: orgId ? `/ops/organizations?org=${orgId}&branch=${g.branch_id}&group=${g.id}` : "/ops/organizations",
    });
  }
  for (const b of branches.data ?? []) results.push({ kind: "branch", id: b.id, label: b.internal_name, href: `/ops/organizations?org=${b.organization_id}&branch=${b.id}` });
  for (const o of orgs.data ?? []) results.push({ kind: "organization", id: o.id, label: o.legal_name, href: `/ops/organizations/${o.id}` });
  for (const t of tasks.data ?? []) results.push({ kind: "task", id: t.id, label: t.title, href: `/tasks/all?open=${t.id}` });
  return results;
}

// חיפוש גלובלי אמיתי: תלמיד/קבוצה/סניף/עמותה/משימה (RLS כבר מגביל לכל משתמש את מה
// שהוא רואה ממילא - אין כאן בדיקת הרשאה נוספת). קבוצה/סניף מקשרים למסך סניפים-וקבוצות
// עם ?org=<organization_id> כדי לקדם-בחור את העמותה הנכונה (אין עדיין deep-link לסניף/קבוצה
// ספציפיים בתוך המסך עצמו), תלמיד/עמותה/משימה מקשרים ישירות לכרטיס.
export function GlobalSearch() {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [searchFailed, setSearchFailed] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    // תשובה של חיפוש קודם שמגיעה אחרי שהמונח השתנה - לא מוצגת (עד היום יכלה לדרוס
    // את תוצאות החיפוש החדש).
    let stale = false;
    const handle = setTimeout(() => {
      search(term.trim())
        .then((r) => {
          if (stale) return;
          setSearchFailed(false);
          setResults(r);
          setOpen(true);
        })
        .catch(() => {
          if (stale) return;
          setSearchFailed(true);
          setResults([]);
          setOpen(true);
        });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(handle);
    };
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
      <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
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
        <div className="absolute z-20 mt-1 w-full rounded-control border border-line bg-surface py-1 shadow-lg">
          {results.map((r) => (
            <button
              key={`${r.kind}-${r.id}`}
              onClick={() => {
                navigate(r.href);
                setOpen(false);
                setTerm("");
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-right text-sm hover:bg-surface-muted"
            >
              <span>
                {r.label}
                {r.sublabel && <span className="text-ink-subtle"> · {r.sublabel}</span>}
              </span>
              <span className="text-xs text-ink-subtle">{KIND_LABEL[r.kind]}</span>
            </button>
          ))}
        </div>
      )}
      {open && term.trim().length >= 2 && results.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-control border border-line bg-surface p-3 text-sm text-ink-subtle shadow-lg">{searchFailed ? "החיפוש נכשל. כדאי לנסות שוב." : "אין תוצאות"}</div>
      )}
    </div>
  );
}
