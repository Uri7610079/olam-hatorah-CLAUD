import { todayLocalIso } from "@/lib/today";
import { useMemo, useState, type FormEvent } from "react";
import { MultiSelect } from "@/components/MultiSelect";
import { normalizeIsraeliPhone } from "@/lib/israeliPhone";
import { PhoneField } from "@/components/PhoneField";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, FileDown, FileUp, UserPlus, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { useSavedFilters } from "@/lib/savedFilters";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import { exportRowsToExcel } from "@/lib/reportExport";
import { PageHeader } from "@/components/PageHeader";
import { SearchAndFilters } from "@/components/SearchAndFilters";
import { DataTable, filterColumnsFor, type DataTableColumn } from "@/components/DataTable";
import { fetchAll } from "@/lib/fetchAll";
import { EMPTY_FILTER_STATE, applyColumnFilters, type ColumnFilterState } from "@/lib/columnFilters";
import { StatusBadge, type Severity } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ActionsMenu } from "@/components/ActionsMenu";
import { CountChips, type ChipTone } from "@/components/CountChips";
import { useIsV3 } from "@/lib/uiTheme";
import { formatPhone } from "@/lib/format";
import { formatStudentAddress, ID_TYPE_LABEL, STATUS_LABEL, type Student, type StudentIdType } from "./types";
import { StudentsImportPanel } from "./StudentsImportPanel";

const PAGE_SIZE = 50;
const SCREEN_KEY = "students-list";

// כל התלמידים נטענים, והחיפוש, הסינון (גם בכותרות העמודות, כמו באקסל), המיון
// והחלוקה לעמודים נעשים בדפדפן. כשהשרת חילק לעמודים, סינון בכותרת היה מסנן
// רק את 25 השורות שעל המסך, וייצוא לאקסל הוציא רק אותן.
// סינון לפי מקום: עמותה, סניף או קבוצה - דרך השיוך הפעיל. מגיע מהקישור
// "תלמידים" במסך סניפים וקבוצות.
export type PlaceFilter = { kind: "org" | "branch" | "group"; id: string } | null;
const PLACE_COLUMN = { org: "organization_id", branch: "branch_id", group: "group_id" } as const;

// השיוך הפעיל לתצוגה. הסינון על is_active חל על השורות המוטמעות בלבד, לא על
// התלמידים - תלמיד בלי שיוך פעיל עדיין מופיע, עם "—".
const PLACEMENT = "assignment:student_assignments(is_active, organization:organizations(id, legal_name), branch:branches(id, internal_name, talmud_branch_code), group:groups(id, name))";

async function fetchStudents(place: PlaceFilter): Promise<Student[]> {
  // סינון לפי מקום דורש שיוך פעיל במקום הזה - inner, בשם נפרד מזה שבתצוגה
  const filterEmbed = place ? ", placefilter:student_assignments!inner(is_active, organization_id, branch_id, group_id)" : "";
  const data = await fetchAll(() => {
    let query = supabase
      .from("students")
      .select(
        `id, id_type, external_id, full_name, birth_date, phone_raw, phone_normalized, address_street, address_house_number, address_city, student_type, study_code, status, exit_date, exit_reason, created_at, ${PLACEMENT}${filterEmbed}`,
      )
      .eq("assignment.is_active", true);
    if (place) query = query.eq("placefilter.is_active", true).eq(`placefilter.${PLACE_COLUMN[place.kind]}`, place.id);
    return query.order("full_name").order("id");
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map(({ placefilter: _f, assignment, ...s }: any) => {
    const a = Array.isArray(assignment) ? assignment[0] : assignment;
    const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
    return { ...s, assignment: a ? { organization: one(a.organization), branch: one(a.branch), group: one(a.group) } : null } as Student;
  });
}

const STATUS_SEVERITY: Record<Student["status"], Severity> = {
  draft: "neutral",
  ready_for_talmud: "medium",
  sent_to_talmud: "medium",
  active: "ok",
  active_with_error: "high",
  inactive: "neutral",
};

const CHIP_TONE: Record<Student["status"], ChipTone> = {
  draft: "neutral",
  ready_for_talmud: "info",
  sent_to_talmud: "warn",
  active: "ok",
  active_with_error: "high",
  inactive: "neutral",
};

// תא ריק (v3): מקף מאופק, כדי ששורה עם חוסרים לא תיראה כמו שורה מלאה.
const Empty = ({ text = "—" }: { text?: string }) => <span className="text-ink-subtle">{text}</span>;

interface BulkAdvanceResult {
  advanced: number;
  missing_phone: number;
  missing_assignment: number;
  missing_bank: number;
  invalid_bank: number;
}

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
      if (place.kind === "org") {
        const { data } = await supabase.from("organizations").select("legal_name").eq("id", place.id).maybeSingle();
        return data?.legal_name ?? "";
      }
      // סניף וקבוצה - עם ההקשר שלהם. שם קבוצה חוזר בכמה סניפים, ו"קבוצת אלישיב"
      // לבד לא אומר באיזו מהן מדובר.
      if (place.kind === "branch") {
        const { data } = await supabase.from("branches").select("internal_name, talmud_branch_code, organization:organizations(legal_name)").eq("id", place.id).maybeSingle();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = data as any;
        if (!d) return "";
        const org = Array.isArray(d.organization) ? d.organization[0] : d.organization;
        return `${d.internal_name}${d.internal_name !== d.talmud_branch_code ? ` (${d.talmud_branch_code})` : ""}${org?.legal_name ? ` · ${org.legal_name}` : ""}`;
      }
      const { data } = await supabase.from("groups").select("name, branch:branches(internal_name, talmud_branch_code, organization:organizations(legal_name))").eq("id", place.id).maybeSingle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      if (!d) return "";
      const br = Array.isArray(d.branch) ? d.branch[0] : d.branch;
      const org = br ? (Array.isArray(br.organization) ? br.organization[0] : br.organization) : null;
      return [d.name, br ? `סניף ${br.talmud_branch_code}` : null, org?.legal_name].filter(Boolean).join(" · ");
    },
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFilterState>(EMPTY_FILTER_STATE);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkAdvanceResult | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  // "אישור כל המוכנים" משנה סטטוס לתלמידים רבים בבת אחת - רק אחרי אישור.
  const [confirmBulk, setConfirmBulk] = useState(false);

  useEscapeToClose(showCreate, () => setShowCreate(false));
  const [savingFilterName, setSavingFilterName] = useState("");

  const query = useQuery({ queryKey: ["students", "all", place?.kind, place?.id], queryFn: () => fetchStudents(place) });
  // חיפוש - לפי שם, מזהה או טלפון (הטלפון בספרות בלבד, כך ש-052-123 ו-052123 שניהם נמצאים).
  const searched = useMemo(() => {
    const term = search.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    return (query.data ?? []).filter((s) =>
      !term ||
      s.full_name.toLowerCase().includes(term) ||
      s.external_id.toLowerCase().includes(term) ||
      (digits.length >= 3 && (s.phone_raw ?? "").replace(/\D/g, "").includes(digits)));
  }, [query.data, search]);
  // סטטוס - על תוצאות החיפוש. eq לסטטוס אחד, כמה - כל אחד מהם. ריק = הכל.
  const rows = useMemo(
    () => searched.filter((s) => !statusFilter.length || statusFilter.includes(s.status)),
    [searched, statusFilter],
  );
  const isV3 = useIsV3();
  // ספירה לפי סטטוס (v3) - מתוך מה שכבר נטען ואחרי החיפוש, כך שהמספרים תואמים את מה שיוצג בלחיצה.
  const statusChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of searched) counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
    return (Object.keys(STATUS_LABEL) as Student["status"][]).map((st) => ({
      value: st,
      label: STATUS_LABEL[st],
      count: counts.get(st) ?? 0,
      tone: CHIP_TONE[st],
    }));
  }, [searched]);
  const savedFilters = useSavedFilters(SCREEN_KEY);

  const applySavedFilter = (id: string) => {
    const f = savedFilters.filters.find((sf) => sf.id === id);
    if (!f) return;
    setSearch(String(f.filters.search ?? ""));
    // מסנן שנשמר לפני מעבר לבחירה מרובה מחזיק מחרוזת אחת, והוא
    // עדיין צריך לעבוד למי ששמר אותו.
    const savedStatus = f.filters.statusFilter;
    setStatusFilter(Array.isArray(savedStatus) ? savedStatus.map(String) : savedStatus ? [String(savedStatus)] : []);
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

  // אישור קבוצתי: כל תלמיד בטיוטה שיש לו טלפון, שיוך פעיל וחשבון בנק תקין עובר
  // ל"מוכן לתלמוד". השאר נשארים, ומוצג כמה ולמה. (בדרך כלל זה כבר קורה לבד ברגע
  // שהפרט האחרון נכנס - הלחצן הוא לבדיקה חוזרת ולתמונת מצב.)
  const runBulkAdvance = async () => {
    setBulkRunning(true);
    setBulkError(null);
    setBulkResult(null);
    const { data, error } = await supabase.rpc("bulk_advance_ready_students");
    setBulkRunning(false);
    if (error) {
      setBulkError(error.message);
      return;
    }
    setBulkResult((Array.isArray(data) ? data[0] : data) as BulkAdvanceResult);
    queryClient.invalidateQueries({ queryKey: ["students"] });
  };

  const exportStudents = () => {
    // בדיוק מה שמוצג: אחרי החיפוש, הסטטוס, והסינון והמיון בכותרות
    const shown = applyColumnFilters(rows, filterColumnsFor(columns, rows), columnFilters);
    const out = shown.map((s) => ({
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
    exportRowsToExcel(out, "תלמידים", `students-${todayLocalIso()}.xlsx`);
  };

  const columns: DataTableColumn<Student>[] = [
    {
      key: "id",
      header: "מזהה",
      className: "tabular",
      filterValue: (s) => `${ID_TYPE_LABEL[s.id_type]} ${s.external_id}`,
      // v3: סוג המזהה מאופק והמספר עצמו מבודד כיוונית (שלא יתהפך ליד טקסט עברי)
      render: (s) =>
        isV3 ? (
          <span className="inline-flex items-baseline gap-1.5">
            <span className="text-xs text-ink-subtle">{ID_TYPE_LABEL[s.id_type]}</span>
            <span className="ltr-num">{s.external_id}</span>
          </span>
        ) : (
          `${ID_TYPE_LABEL[s.id_type]} ${s.external_id}`
        ),
    },
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
        : isV3 ? <Empty text="לא משויך" /> : "—",
    },
    {
      key: "branch",
      header: "סניף",
      render: (s) => s.assignment?.branch && s.assignment.organization
        ? <Link to={`/ops/organizations?org=${s.assignment.organization.id}&branch=${s.assignment.branch.id}`} className="link-action">
            {s.assignment.branch.internal_name}
          </Link>
        : isV3 ? <Empty /> : "—",
    },
    {
      key: "group",
      header: "קבוצה",
      render: (s) => s.assignment?.group && s.assignment.branch && s.assignment.organization
        ? <Link to={`/ops/organizations?org=${s.assignment.organization.id}&branch=${s.assignment.branch.id}&group=${s.assignment.group.id}`} className="link-action">
            {s.assignment.group.name}
          </Link>
        : isV3 ? <Empty /> : "—",
    },
    {
      key: "phone",
      header: "טלפון",
      className: "ltr-num",
      filterValue: (s) => s.phone_raw ?? "",
      // v3: תצוגה אחידה 052-1234567 (הערך השמור לא משתנה)
      render: (s) => (isV3 ? (s.phone_raw ? formatPhone(s.phone_raw) || s.phone_raw : <Empty />) : s.phone_raw ?? "—"),
    },
    { key: "status", header: "סטטוס", render: (s) => <StatusBadge severity={STATUS_SEVERITY[s.status]} label={STATUS_LABEL[s.status]} /> },
    { key: "student_type", header: "סוג תלמיד", hiddenByDefault: true, render: (s) => s.student_type ?? "—" },
    { key: "study_code", header: "קוד לימוד", hiddenByDefault: true, render: (s) => s.study_code ?? "—" },
    { key: "address", header: "כתובת", hiddenByDefault: true, render: (s) => formatStudentAddress(s) },
  ];

  return (
    <div>
      <ConfirmDialog
        open={confirmBulk}
        title="אישור כל המוכנים לתלמוד"
        description="המערכת תעבור על כל התלמידים בטיוטה, ותעביר ל&quot;מוכן לתלמוד&quot; את מי שיש לו טלפון, שיוך וחשבון בנק תקין. מי שחסר לו פרט יישאר בטיוטה, ויוצג כמה כאלה יש."
        confirmLabel="להעביר את המוכנים"
        onConfirm={() => {
          setConfirmBulk(false);
          runBulkAdvance();
        }}
        onCancel={() => setConfirmBulk(false)}
      />
      <PageHeader
        title="תלמידים"
        description="ניהול תלמידים, שיוכים וחשבונות בנק."
        primaryAction={
          isV3 ? (
            // v3: פעולה ראשית אחת. יבוא ואישור קבוצתי הם פעולות לא יומיומיות - בתפריט.
            <div className="flex flex-wrap items-center gap-2">
              <ActionsMenu
                actions={[
                  ...(canManage
                    ? [
                        { key: "import", label: showImport ? "סגירת היבוא" : "יבוא מאקסל", icon: FileUp, onSelect: () => setShowImport((v) => !v) },
                        {
                          key: "bulk",
                          label: bulkRunning ? "בודק…" : "אישור כל המוכנים לתלמוד",
                          hint: "מעביר ל\"מוכן לתלמוד\" כל טיוטה שיש לה את כל הפרטים",
                          icon: CheckCheck,
                          disabled: bulkRunning,
                          onSelect: () => setConfirmBulk(true),
                        },
                      ]
                    : []),
                ]}
              />
              <button onClick={exportStudents} className="btn-secondary">
                <FileDown className="h-4 w-4" aria-hidden="true" />
                ייצוא לאקסל
              </button>
              {canManage && (
                <button onClick={() => setShowCreate(true)} className="btn-primary">
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  תלמיד חדש
                </button>
              )}
            </div>
          ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={exportStudents} className="btn-secondary">
              ייצוא לאקסל
            </button>
            {canManage && (
              <button onClick={() => setConfirmBulk(true)} disabled={bulkRunning} className="btn-secondary">
                {bulkRunning ? "בודקת…" : "אישור כל המוכנים לתלמוד"}
              </button>
            )}
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
          )
        }
      />

      {bulkError && <div className="mb-4"><ErrorState message={bulkError} /></div>}
      {bulkResult && (
        <div className="card mb-4 flex items-start justify-between gap-3 p-4 text-sm">
          <div className="space-y-1">
            <p className="font-medium">
              {bulkResult.advanced > 0 ? `${bulkResult.advanced} תלמידים עברו ל"מוכן לתלמוד".` : "אין תלמידים חדשים שמוכנים לתלמוד."}
            </p>
            {(() => {
              const left = [
                bulkResult.missing_phone > 0 && `${bulkResult.missing_phone} בלי טלפון`,
                bulkResult.missing_assignment > 0 && `${bulkResult.missing_assignment} בלי שיוך לקבוצה`,
                bulkResult.missing_bank > 0 && `${bulkResult.missing_bank} בלי חשבון בנק`,
                bulkResult.invalid_bank > 0 && `${bulkResult.invalid_bank} עם מספר חשבון שגוי`,
              ].filter(Boolean);
              return left.length > 0 ? <p className="text-ink-muted">נשארו בטיוטה: {left.join(" · ")}.</p> : null;
            })()}
          </div>
          <button onClick={() => setBulkResult(null)} className="text-ink-subtle hover:text-ink" aria-label="סגירה">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {showImport && canManage && <StudentsImportPanel />}

      <SearchAndFilters
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="חיפוש לפי שם, מזהה או טלפון…"
        advancedFilters={
          <div className="flex flex-wrap items-center gap-2">
            <MultiSelect
              className="w-48"
              options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
              value={statusFilter}
              onChange={setStatusFilter}
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
            {/* v3: שמירת מסנן מוצגת רק כשיש מה לשמור (חיפוש או סטטוס) - אחרת היא רעש קבוע */}
            {(!isV3 || search.trim() || statusFilter.length > 0) && (
              <>
                <input
                  value={savingFilterName}
                  onChange={(e) => setSavingFilterName(e.target.value)}
                  placeholder="שם למסנן חדש"
                  aria-label="שם למסנן חדש"
                  className="input-field w-32"
                />
                <button onClick={saveCurrentFilter} disabled={!savingFilterName.trim()} className="btn-secondary text-xs">
                  שמירת מסנן
                </button>
              </>
            )}
          </div>
        }
      />

      {place && (
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-700">
            מסונן לפי {place.kind === "org" ? "עמותה" : place.kind === "branch" ? "סניף" : "קבוצת"} {placeName.data || "…"}
            {query.data && <span className="text-brand-700/70">· {query.data.length} תלמידים</span>}
            <button
              onClick={() => setSearchParams({})}
              aria-label="ביטול הסינון"
              className="rounded-full p-0.5 hover:bg-brand-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        </div>
      )}
      {query.isError && <ErrorState message="שגיאה בטעינת רשימת התלמידים." />}
      {isV3 && query.data && query.data.length > 0 && (
        <CountChips
          ariaLabel="סינון לפי סטטוס"
          chips={statusChips}
          total={searched.length}
          allLabel="כל התלמידים"
          active={statusFilter.length === 1 ? statusFilter[0] : null}
          onSelect={(v) => setStatusFilter(v ? [v] : [])}
        />
      )}
      <DataTable
        tableId="students-list"
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}
        // "אין תלמידים עדיין" רק כשהמאגר באמת ריק; כשיש תלמידים אבל החיפוש או המסננים
        // לא מצאו אף אחד - אומרים את זה (INT-07)
        emptyTitle={(query.data?.length ?? 0) > 0 ? "לא נמצאו תלמידים התואמים לחיפוש או למסננים" : "אין תלמידים עדיין"}
        emptyDescription={(query.data?.length ?? 0) > 0 ? "אפשר לנקות את החיפוש או את המסננים כדי לראות את כל התלמידים." : undefined}
        emptyIcon={Users}
        columnPicker
        clientPageSize={PAGE_SIZE}
        filterState={[columnFilters, setColumnFilters]}
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
