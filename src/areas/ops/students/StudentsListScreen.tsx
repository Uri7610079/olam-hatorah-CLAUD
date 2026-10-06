import { useState, type FormEvent } from "react";
import { MultiSelect } from "@/components/MultiSelect";
import { normalizeIsraeliPhone } from "@/lib/israeliPhone";
import { PhoneField } from "@/components/PhoneField";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { useSavedFilters } from "@/lib/savedFilters";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import { exportRowsToExcel } from "@/lib/reportExport";
import { PageHeader } from "@/components/PageHeader";
import { SearchAndFilters } from "@/components/SearchAndFilters";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge, type Severity } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { formatStudentAddress, ID_TYPE_LABEL, STATUS_LABEL, type Student, type StudentIdType } from "./types";
import { StudentsImportPanel } from "./StudentsImportPanel";

const PAGE_SIZE = 25;
const SCREEN_KEY = "students-list";

interface FetchResult {
  rows: Student[];
  totalCount: number;
}

// חיפוש וסינון בצד שרת + pagination אמיתי - "אלפי תלמידים, pagination וחיפוש צד שרת"
// באפיון (§9, נפח). זו הטבלה הכי גדולת-נפח במערכת, ולכן הראשונה שמקבלת את היכולת הזו
// (שאר הטבלאות הקטנות יותר ממשיכות עם הדפוס הישן - סינון בצד לקוח על כל הנתונים).
// סינון לפי מקום: עמותה, סניף או קבוצה - דרך השיוך הפעיל. מגיע מהקישור
// "תלמידים" במסך סניפים וקבוצות.
export type PlaceFilter = { kind: "org" | "branch" | "group"; id: string } | null;
const PLACE_COLUMN = { org: "organization_id", branch: "branch_id", group: "group_id" } as const;

// השיוך הפעיל לתצוגה. הסינון על is_active חל על השורות המוטמעות בלבד, לא על
// התלמידים - תלמיד בלי שיוך פעיל עדיין מופיע, עם "—".
const PLACEMENT = "assignment:student_assignments(is_active, organization:organizations(id, legal_name), branch:branches(id, internal_name, talmud_branch_code), group:groups(id, name))";

async function fetchStudents(search: string, statusFilter: string[], page: number, place: PlaceFilter): Promise<FetchResult> {
  // סינון לפי מקום דורש שיוך פעיל במקום הזה - inner, בשם נפרד מזה שבתצוגה
  const filterEmbed = place ? ", placefilter:student_assignments!inner(is_active, organization_id, branch_id, group_id)" : "";
  let query = supabase
    .from("students")
    .select(
      `id, id_type, external_id, full_name, birth_date, phone_raw, phone_normalized, address_street, address_house_number, address_city, student_type, study_code, status, exit_date, exit_reason, created_at, ${PLACEMENT}${filterEmbed}`,
      { count: "exact" },
    )
    .eq("assignment.is_active", true)
    .order("full_name")
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (place) query = query.eq("placefilter.is_active", true).eq(`placefilter.${PLACE_COLUMN[place.kind]}`, place.id);

  if (search.trim()) {
    const term = search.trim();
    query = query.or(`full_name.ilike.%${term}%,external_id.ilike.%${term}%`);
  }
  // eq לסטטוס אחד, in לכמה. ריק = ללא סינון כלל.
  if (statusFilter.length === 1) query = query.eq("status", statusFilter[0]);
  else if (statusFilter.length > 1) query = query.in("status", statusFilter);

  const { data, error, count } = await query;
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []).map(({ placefilter: _f, assignment, ...s }: any) => {
    const a = Array.isArray(assignment) ? assignment[0] : assignment;
    const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
    return { ...s, assignment: a ? { organization: one(a.organization), branch: one(a.branch), group: one(a.group) } : null } as Student;
  });
  return { rows, totalCount: count ?? 0 };
}

const STATUS_SEVERITY: Record<Student["status"], Severity> = {
  draft: "neutral",
  ready_for_talmud: "medium",
  sent_to_talmud: "medium",
  active: "ok",
  active_with_error: "high",
  inactive: "neutral",
};

const EMPTY_FORM = { id_type: "israeli_id" as StudentIdType, external_id: "", full_name: "", phone: "" };

export function StudentsListScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("students", "manage");

  const [searchParams, setSearchParams] = useSearchParams();
  const place: PlaceFilter = searchParams.get("group") ? { kind: "group", id: searchParams.get("group")! }
    : searchParams.get("branch") ? { kind: "branch", id: searchParams.get("branch")! }
    : searchParams.get("org") ? { kind: "org", id: searchParams.get("org")! }
    : null;
  // השם שמוצג בתגית הסינון ("מסונן לפי קבוצת אלישיב")
  const placeName = useQuery({
    queryKey: ["place-name", place?.kind, place?.id],
    enabled: !!place,
    queryFn: async () => {
      if (!place) return "";
      const table = place.kind === "org" ? "organizations" : place.kind === "branch" ? "branches" : "groups";
      const col = place.kind === "org" ? "legal_name" : place.kind === "branch" ? "internal_name" : "name";
      const { data } = await supabase.from(table).select(col).eq("id", place.id).maybeSingle();
      return (data as Record<string, string> | null)?.[col] ?? "";
    },
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEscapeToClose(showCreate, () => setShowCreate(false));
  const [savingFilterName, setSavingFilterName] = useState("");

  const query = useQuery({ queryKey: ["students", search, statusFilter.join(","), page, place?.kind, place?.id], queryFn: () => fetchStudents(search, statusFilter, page, place) });
  const savedFilters = useSavedFilters(SCREEN_KEY);

  const applySavedFilter = (id: string) => {
    const f = savedFilters.filters.find((sf) => sf.id === id);
    if (!f) return;
    setSearch(String(f.filters.search ?? ""));
    // מסנן שנשמר לפני מעבר לבחירה מרובה מחזיק מחרוזת אחת, והוא
    // עדיין צריך לעבוד למי ששמר אותו.
    const savedStatus = f.filters.statusFilter;
    setStatusFilter(Array.isArray(savedStatus) ? savedStatus.map(String) : savedStatus ? [String(savedStatus)] : []);
    setPage(0);
  };

  const saveCurrentFilter = async () => {
    if (!savingFilterName.trim()) return;
    await savedFilters.save(savingFilterName.trim(), { search, statusFilter });
    setSavingFilterName("");
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    // הצורה הקנונית ולא ספרות-בלבד: phone_normalized הוא מה שההתאמה
    // לרשימות הטלפון משווה, ו-"+972521234567" מול "0521234567" הם אותו
    // אדם ששתי מחרוזות שונות מייצגות.
    const phoneDigits = normalizeIsraeliPhone(form.phone);
    const { data, error } = await supabase
      .from("students")
      .insert({
        id_type: form.id_type,
        external_id: form.external_id,
        full_name: form.full_name,
        phone_raw: form.phone || null,
        phone_normalized: phoneDigits || null,
      })
      .select("id")
      .single();
    setCreating(false);
    if (error) {
      setCreateError(error.message.includes("duplicate") ? "כבר קיים תלמיד עם אותו סוג מזהה ומספר מזהה." : error.message);
      return;
    }
    setShowCreate(false);
    setForm(EMPTY_FORM);
    queryClient.invalidateQueries({ queryKey: ["students"] });
    if (data) navigate(`/ops/students/${data.id}`);
  };

  const exportStudents = () => {
    const rows = (query.data?.rows ?? []).map((s) => ({
      מזהה: `${ID_TYPE_LABEL[s.id_type]} ${s.external_id}`,
      שם: s.full_name,
      טלפון: s.phone_raw ?? "",
      סטטוס: STATUS_LABEL[s.status],
      "סוג תלמיד": s.student_type ?? "",
      "קוד לימוד": s.study_code ?? "",
      עמותה: s.assignment?.organization?.legal_name ?? "",
      סניף: s.assignment?.branch?.internal_name ?? "",
      קבוצה: s.assignment?.group?.name ?? "",
      רחוב: s.address_street ?? "",
      "מספר בית": s.address_house_number ?? "",
      עיר: s.address_city ?? "",
    }));
    exportRowsToExcel(rows, "תלמידים", `students-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const columns: DataTableColumn<Student>[] = [
    { key: "id", header: "מזהה", className: "tabular", render: (s) => `${ID_TYPE_LABEL[s.id_type]} ${s.external_id}` },
    {
      key: "name",
      header: "שם",
      render: (s) => (
        <button onClick={() => navigate(`/ops/students/${s.id}`)} className="link-action font-medium">
          {s.full_name}
        </button>
      ),
    },
    // שיוך: כל אחד קישור. עמותה - לכרטיס העמותה. סניף וקבוצה - למסך סניפים
    // וקבוצות, כשהעמותה והסניף כבר נבחרו והקבוצה מסומנת.
    {
      key: "organization",
      header: "עמותה",
      render: (s) => s.assignment?.organization
        ? <Link to={`/ops/organizations/${s.assignment.organization.id}`} className="link-action">{s.assignment.organization.legal_name}</Link>
        : "—",
    },
    {
      key: "branch",
      header: "סניף",
      render: (s) => s.assignment?.branch && s.assignment.organization
        ? <Link to={`/ops/branches-groups?org=${s.assignment.organization.id}&branch=${s.assignment.branch.id}`} className="link-action">
            {s.assignment.branch.internal_name}
          </Link>
        : "—",
    },
    {
      key: "group",
      header: "קבוצה",
      render: (s) => s.assignment?.group && s.assignment.branch && s.assignment.organization
        ? <Link to={`/ops/branches-groups?org=${s.assignment.organization.id}&branch=${s.assignment.branch.id}&group=${s.assignment.group.id}`} className="link-action">
            {s.assignment.group.name}
          </Link>
        : "—",
    },
    { key: "phone", header: "טלפון", className: "ltr-num", render: (s) => s.phone_raw ?? "—" },
    { key: "status", header: "סטטוס", render: (s) => <StatusBadge severity={STATUS_SEVERITY[s.status]} label={STATUS_LABEL[s.status]} /> },
    { key: "student_type", header: "סוג תלמיד", hiddenByDefault: true, render: (s) => s.student_type ?? "—" },
    { key: "study_code", header: "קוד לימוד", hiddenByDefault: true, render: (s) => s.study_code ?? "—" },
    { key: "address", header: "כתובת", hiddenByDefault: true, render: (s) => formatStudentAddress(s) },
  ];

  return (
    <div>
      <PageHeader
        title="תלמידים"
        description="ניהול תלמידים, שיוכים וחשבונות בנק."
        primaryAction={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={exportStudents} className="btn-secondary">
              ייצוא לאקסל
            </button>
            {canManage && (
              <button onClick={() => setShowImport((v) => !v)} className="btn-secondary">
                {showImport ? "סגירת יבוא" : "יבוא מאקסל"}
              </button>
            )}
            {canManage && (
              <button onClick={() => setShowCreate(true)} className="btn-primary">
                תלמיד חדש
              </button>
            )}
          </div>
        }
      />

      {showImport && canManage && <StudentsImportPanel />}

      <SearchAndFilters
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
        searchPlaceholder="חיפוש לפי שם או מספר מזהה…"
        advancedFilters={
          <div className="flex flex-wrap items-center gap-2">
            <MultiSelect
              className="w-48"
              options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(0);
              }}
              emptyMeaning="כל הסטטוסים"
            />
            {savedFilters.filters.length > 0 && (
              <select onChange={(e) => e.target.value && applySavedFilter(e.target.value)} className="input-field" defaultValue="">
                <option value="">— מסננים שמורים —</option>
                {savedFilters.filters.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
            <input
              value={savingFilterName}
              onChange={(e) => setSavingFilterName(e.target.value)}
              placeholder="שם למסנן חדש"
              className="input-field w-32"
            />
            <button onClick={saveCurrentFilter} disabled={!savingFilterName.trim()} className="btn-secondary text-xs">
              שמירת מסנן
            </button>
          </div>
        }
      />

      {place && (
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-700">
            מסונן לפי {place.kind === "org" ? "עמותה" : place.kind === "branch" ? "סניף" : "קבוצת"} {placeName.data || "…"}
            {query.data && <span className="text-brand-700/70">· {query.data.totalCount} תלמידים</span>}
            <button
              onClick={() => { setSearchParams({}); setPage(0); }}
              aria-label="ביטול הסינון"
              className="rounded-full p-0.5 hover:bg-brand-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        </div>
      )}
      {query.isError && <ErrorState message="שגיאה בטעינת רשימת התלמידים." />}
      <DataTable
        columns={columns}
        rows={query.data?.rows ?? []}
        rowKey={(s) => s.id}
        loading={query.isLoading}
        emptyTitle="אין תלמידים עדיין"
        emptyIcon={Users}
        columnPicker
        pagination={{ page, pageSize: PAGE_SIZE, totalCount: query.data?.totalCount ?? 0, onPageChange: setPage }}
      />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
          <div role="dialog" aria-modal="true" aria-labelledby="new-student-title" className="card w-full max-w-md p-6">
            <h2 id="new-student-title" className="mb-1 text-base font-semibold text-ink">תלמיד חדש</h2>
            <p className="mb-4 text-xs text-ink-subtle">נוצר כטיוטה. שיוך, חשבון בנק והפעלה מתבצעים בכרטיס התלמיד.</p>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="field-label">סוג מזהה</label>
                  <select
                    value={form.id_type}
                    onChange={(e) => setForm((f) => ({ ...f, id_type: e.target.value as StudentIdType }))}
                    className="input-field"
                  >
                    {Object.entries(ID_TYPE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">מספר מזהה</label>
                  <input required value={form.external_id} onChange={(e) => setForm((f) => ({ ...f, external_id: e.target.value }))} className="input-field tabular" />
                </div>
              </div>
              <div>
                <label className="field-label">שם מלא</label>
                <input required value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} className="input-field" />
              </div>
              <PhoneField
                id="new-student-phone"
                value={form.phone}
                onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
              />
              {createError && <ErrorState message={createError} />}
              <button type="submit" disabled={creating} className="btn-primary w-full">
                {creating ? "יוצרת…" : "יצירה"}
              </button>
            </form>
            <button onClick={() => setShowCreate(false)} className="link-action mt-3 text-xs">
              ביטול
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
