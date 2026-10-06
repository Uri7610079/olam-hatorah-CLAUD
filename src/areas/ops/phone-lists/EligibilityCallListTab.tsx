import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, PhoneCall } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useLastSelected } from "@/lib/useLastSelected";
import { exportRowsToExcel } from "@/lib/reportExport";
import { DataTable } from "@/components/DataTable";
import { Tabs } from "@/components/Tabs";
import { ErrorState } from "@/components/ErrorState";

interface OrgOption {
  id: string;
  legal_name: string;
}

interface ListOption {
  id: string;
  month: string;
  file_name: string;
  created_at: string;
}

type Category = "ready" | "no_phone" | "not_found";

interface CallRow {
  student_id: string | null;
  external_id: string;
  first_name: string | null;
  last_name: string | null;
  branch_code: string | null;
  branch_name: string | null;
  group_name: string | null;
  phone: string | null;
  category: Category;
}

const CATEGORY_LABEL: Record<Category, string> = {
  ready: "מוכנים לייצוא",
  no_phone: "זכאים בלי טלפון במערכת",
  not_found: "זכאים שלא נמצאו במערכת",
};

const monthLabel = (iso: string) => {
  const [y, m] = iso.split("-");
  return `${m}/${y}`;
};

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchLists(orgId: string): Promise<ListOption[]> {
  const { data, error } = await supabase
    .from("talmud_eligibility_lists")
    .select("id, month, file_name, created_at")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .order("month", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function fetchCallList(orgId: string, month: string): Promise<CallRow[]> {
  const { data, error } = await supabase.rpc("get_eligibility_call_list", { p_organization_id: orgId, p_month: month });
  if (error) throw error;
  return (data ?? []) as CallRow[];
}

function downloadCsv(rows: Record<string, string>[], fileName: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const body = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h] ?? "")).join(","))].join("\r\n");
  // BOM - כדי שאקסל יפתח את העברית נכון
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// רשימת החיוג: כל מי שתלמוד סימן "זכאי" בדוח הזכאים של העמותה והחודש, עם הטלפון
// מכרטיס התלמיד (מיגרציה 116). רק הזכאים - כי רק הם צריכים התראה לפני ביקורת.
export function EligibilityCallListTab() {
  const [searchParams] = useSearchParams();
  const [orgId, setOrgId] = useLastSelected<string>("last-org", "");
  const [month, setMonth] = useState<string>(searchParams.get("month") ?? "");
  const [branch, setBranch] = useState<string>("");
  const [category, setCategory] = useState<Category>("ready");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // הגעה מקליטת דוח הזכאים: העמותה והחודש כבר בכתובת
  useEffect(() => {
    const o = searchParams.get("org");
    if (o) setOrgId(o);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });
  const listsQuery = useQuery({ queryKey: ["eligibility-lists-active", orgId], queryFn: () => fetchLists(orgId), enabled: !!orgId });

  // ברירת מחדל: החודש האחרון שיש לו דוח
  useEffect(() => {
    const lists = listsQuery.data ?? [];
    if (lists.length > 0 && !lists.some((l) => l.month === month)) setMonth(lists[0].month);
    if (lists.length === 0 && listsQuery.isSuccess) setMonth("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listsQuery.data]);

  const callQuery = useQuery({
    queryKey: ["eligibility-call-list", orgId, month],
    queryFn: () => fetchCallList(orgId, month),
    enabled: !!orgId && !!month,
  });

  const all = callQuery.data ?? [];
  const branches = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of all) if (r.branch_code) map.set(r.branch_code, r.branch_name ?? "");
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [all]);
  const inBranch = all.filter((r) => !branch || r.branch_code === branch);
  const counts: Record<Category, number> = {
    ready: inBranch.filter((r) => r.category === "ready").length,
    no_phone: inBranch.filter((r) => r.category === "no_phone").length,
    not_found: inBranch.filter((r) => r.category === "not_found").length,
  };
  const shown = inBranch.filter((r) => r.category === category);
  useEffect(() => setPage(0), [orgId, month, branch, category]);
  const pageRows = shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // לייצוא למערכת הטלפונית: טלפון פעם אחת בלבד - כמה תלמידים עם טלפון בית משותף
  // היו גורמים לכמה שיחות לאותו מספר.
  const forPhoneSystem = useMemo(() => {
    const seen = new Set<string>();
    const out: { first: string; last: string; phone: string }[] = [];
    for (const r of inBranch) {
      if (r.category !== "ready" || !r.phone) continue;
      const key = r.phone.replace(/\D/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ first: r.first_name ?? "", last: r.last_name ?? "", phone: r.phone });
    }
    return out;
  }, [inBranch]);
  const sharedPhones = counts.ready - forPhoneSystem.length;

  const orgName = orgsQuery.data?.find((o) => o.id === orgId)?.legal_name ?? "";
  const fileBase = `call-list-${month.slice(0, 7)}${branch ? `-branch-${branch}` : ""}`;
  const phoneSystemRows = forPhoneSystem.map((r) => ({ "שם פרטי": r.first, "שם משפחה": r.last, "טלפון": r.phone }));

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-ink-muted">
        רשימת החיוג נבנית מ<span className="font-medium text-ink">דוח הזכאים</span> שנקלט מתלמוד: רק תלמידים שסומנו "זכאי" בחודש, עם הטלפון
        מכרטיס התלמיד. דוח זכאים קולטים ב<Link to="/ops/import-center" className="link-action">מרכז היבוא</Link>.
      </p>

      <div className="grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="field-label" htmlFor="cl-org">עמותה</label>
          <select id="cl-org" value={orgId} onChange={(e) => { setOrgId(e.target.value); setBranch(""); }} className="input-field">
            <option value="">— בחרי —</option>
            {(orgsQuery.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.legal_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="cl-month">חודש (לפי דוח הזכאים)</label>
          <select id="cl-month" value={month} onChange={(e) => setMonth(e.target.value)} className="input-field" disabled={!orgId}>
            {(listsQuery.data ?? []).length === 0 && <option value="">— אין דוח —</option>}
            {(listsQuery.data ?? []).map((l) => (
              <option key={l.id} value={l.month}>
                {monthLabel(l.month)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="cl-branch">סניף</label>
          <select id="cl-branch" value={branch} onChange={(e) => setBranch(e.target.value)} className="input-field" disabled={!month}>
            <option value="">כל הסניפים</option>
            {branches.map(([code, name]) => (
              <option key={code} value={code}>
                {code}
                {name ? ` · ${name}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {orgId && listsQuery.isSuccess && (listsQuery.data ?? []).length === 0 && (
        <div className="rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn-ink">
          לעמותה הזו עוד לא נקלט דוח זכאים. קולטים אותו במרכז היבוא, בלשונית "דוח זכאים".
        </div>
      )}
      {callQuery.error && <ErrorState message="שגיאה בטעינת רשימת החיוג." />}

      {orgId && month && (
        <>
          <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm">
              <p className="font-semibold text-ink">
                {orgName} · {monthLabel(month)}
                {branch ? ` · סניף ${branch}` : ""}
              </p>
              <p className="mt-1 text-ink-muted">
                <span className="tabular font-semibold text-ink">{forPhoneSystem.length}</span> מספרי טלפון לייצוא
                {sharedPhones > 0 && ` (${sharedPhones} תלמידים חולקים טלפון עם תלמיד אחר - המספר יופיע פעם אחת)`}
                {counts.no_phone > 0 && ` · ${counts.no_phone} זכאים בלי טלפון`}
                {counts.not_found > 0 && ` · ${counts.not_found} לא נמצאו במערכת`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-primary flex items-center gap-2"
                disabled={forPhoneSystem.length === 0}
                onClick={() => exportRowsToExcel(phoneSystemRows, "רשימת חיוג", `${fileBase}.xlsx`)}
              >
                <PhoneCall className="h-4 w-4" aria-hidden="true" />
                ייצוא למערכת הטלפונית (אקסל)
              </button>
              <button className="btn-secondary text-sm" disabled={forPhoneSystem.length === 0} onClick={() => downloadCsv(phoneSystemRows, `${fileBase}.csv`)}>
                CSV
              </button>
              <button
                className="btn-secondary flex items-center gap-2 text-sm"
                disabled={inBranch.length === 0}
                onClick={() =>
                  exportRowsToExcel(
                    inBranch.map((r) => ({
                      "שם פרטי": r.first_name ?? "",
                      "שם משפחה": r.last_name ?? "",
                      "טלפון": r.phone ?? "",
                      "ת.ז/דרכון": r.external_id,
                      "סניף": r.branch_code ?? "",
                      "שם הסניף": r.branch_name ?? "",
                      "קבוצה": r.group_name ?? "",
                      "מצב": CATEGORY_LABEL[r.category],
                    })),
                    "זכאים",
                    `eligible-full-${month.slice(0, 7)}${branch ? `-branch-${branch}` : ""}.xlsx`,
                  )
                }
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                ייצוא מלא
              </button>
            </div>
          </div>

          <Tabs
            tabs={(Object.keys(CATEGORY_LABEL) as Category[]).map((k) => ({ key: k, label: CATEGORY_LABEL[k], badge: counts[k] }))}
            activeTab={category}
            onChange={setCategory}
            ariaLabel="סינון רשימת החיוג"
          />
          {category === "no_phone" && counts.no_phone > 0 && (
            <p className="text-xs text-warn-ink">התלמידים האלה זכאים אבל לא יקבלו התראה, כי אין להם טלפון במערכת. כדאי להשלים בכרטיס התלמיד.</p>
          )}
          {category === "not_found" && counts.not_found > 0 && (
            <p className="text-xs text-warn-ink">תלמוד מסמן אותם כזכאים, אבל אין במערכת תלמיד עם מספר הזהות הזה. כדאי לבדוק אם צריך להוסיף אותם.</p>
          )}
          <DataTable
            columns={[
              { key: "first", header: "שם פרטי", render: (r: CallRow) => r.first_name ?? "—" },
              { key: "last", header: "שם משפחה", render: (r: CallRow) => r.last_name ?? "—" },
              { key: "phone", header: "טלפון", className: "ltr-num tabular", render: (r: CallRow) => r.phone ?? "—" },
              { key: "id", header: "ת.ז/דרכון", className: "ltr-num tabular", render: (r: CallRow) => r.external_id },
              { key: "branch", header: "סניף", className: "tabular", render: (r: CallRow) => r.branch_code ?? "—" },
              { key: "group", header: "קבוצה", render: (r: CallRow) => r.group_name ?? "—" },
              {
                key: "open",
                header: "",
                render: (r: CallRow) =>
                  r.student_id ? (
                    <Link to={`/ops/students/${r.student_id}`} className="link-action text-xs">
                      כרטיס תלמיד
                    </Link>
                  ) : null,
              },
            ]}
            rows={pageRows}
            rowKey={(r: CallRow) => r.external_id}
            loading={callQuery.isLoading}
            emptyTitle="אין תלמידים בקבוצה הזו"
            emptyIcon={PhoneCall}
            pagination={{ page, pageSize: PAGE_SIZE, totalCount: shown.length, onPageChange: setPage }}
          />
        </>
      )}
    </div>
  );
}
