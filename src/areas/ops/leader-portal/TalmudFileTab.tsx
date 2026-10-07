import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";
import { useHasPermission } from "@/lib/permissions";
import { buildTalmudRow, buildTalmudWorkbook, type TalmudRow } from "@/lib/talmudFile";
import { downloadXls, loadTalmudSources } from "@/lib/talmudFileData";
import { formatDate } from "@/lib/portalRequests";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { TalmudRowStatus } from "../talmud/TalmudRowStatus";
import { ColumnFilterSummary, ColumnHeader, useColumnFilters } from "@/components/ColumnFilter";
import type { FilterColumn } from "@/lib/columnFilters";

// "קובץ לתלמוד": תלמידים שנוספו או עזבו דרך הפורטל ואושרו, וצריך לרשום אותם גם
// בתלמוד. המשרד מוריד קובץ בתבנית של משרד החינוך וקולט אותו בתלמוד (מיגרציה 117).
//
// כל עמותה וכל סניף הם מוסד נפרד בתלמוד, ובתבנית אין עמודת סניף - ולכן קובץ
// נפרד לכל סניף. אחרי ההורדה הבקשות מסומנות "ירדו בקובץ" ולא יופיעו שוב בממתינים.

interface FileRequest {
  id: string;
  kind: "new_student" | "student_left";
  student_id: string | null;
  group_id: string | null;
  payload: Record<string, string | null>;
  decided_at: string | null;
  talmud_file_at: string | null;
  leader: { full_name: string } | null;
}

interface GroupMeta {
  id: string;
  name: string;
  branch: { id: string; internal_name: string; talmud_branch_code: string | null; organization: { id: string; legal_name: string } | null } | null;
}

interface Item {
  request: FileRequest;
  studentName: string;
  row: TalmudRow | null;
  groupName: string | null;
  sectionKey: string;
  sectionLabel: string;
  fileLabel: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const one = <T,>(v: any): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export async function countPendingTalmudFile(): Promise<number> {
  const { count, error } = await supabase.from("portal_change_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved").in("kind", ["new_student", "student_left"]).is("talmud_file_at", null);
  if (error) throw error;
  return count ?? 0;
}

async function fetchItems(done: boolean): Promise<Item[]> {
  const build = () => {
    let q = supabase.from("portal_change_requests")
      .select("id, kind, student_id, group_id, payload, decided_at, talmud_file_at, leader:group_leaders(full_name)")
      .eq("status", "approved").in("kind", ["new_student", "student_left"]);
    q = done ? q.not("talmud_file_at", "is", null).order("talmud_file_at", { ascending: false }) : q.is("talmud_file_at", null).order("decided_at");
    return q.order("id");
  };
  // ירדו כבר בקובץ: 300 האחרונות מספיקות להורדה חוזרת
  const raw = done ? ((await build().range(0, 299)).data ?? []) : await fetchAll(build);
  const requests = raw.map((r) => ({ ...r, leader: one(r.leader) })) as FileRequest[];

  const withStudent = requests.filter((r) => r.student_id);
  const loaded = await loadTalmudSources(withStudent.map((r) => ({
    studentId: r.student_id!,
    groupId: r.kind === "new_student" ? r.group_id : null,
    exitDate: r.kind === "student_left" ? r.payload.exit_date : null,
  })));

  const groupIds = [...new Set(loaded.map((l) => l?.groupId).filter((g): g is string => !!g))];
  const groups = new Map<string, GroupMeta>();
  if (groupIds.length) {
    const { data, error } = await supabase.from("groups")
      .select("id, name, branch:branches(id, internal_name, talmud_branch_code, organization:organizations(id, legal_name))")
      .in("id", groupIds);
    if (error) throw error;
    for (const g of data ?? []) {
      const branch = one<NonNullable<GroupMeta["branch"]>>(g.branch);
      groups.set(g.id, { id: g.id, name: g.name, branch: branch ? { ...branch, organization: one(branch.organization) } : null });
    }
  }

  return withStudent.map((r, i) => {
    const l = loaded[i];
    const g = l?.groupId ? groups.get(l.groupId) : undefined;
    const org = g?.branch?.organization;
    const branchCode = g?.branch?.talmud_branch_code ?? "";
    return {
      request: r,
      studentName: l?.source.full_name ?? r.payload.full_name ?? "—",
      row: l ? buildTalmudRow(l.source) : null,
      groupName: g?.name ?? null,
      sectionKey: g?.branch?.id ?? "none",
      sectionLabel: org ? `${org.legal_name} · ${g?.branch?.internal_name ?? ""}${branchCode ? ` (סניף ${branchCode})` : ""}` : "בלי עמותה וסניף",
      fileLabel: org ? `${org.legal_name}${branchCode ? ` סניף ${branchCode}` : ""}` : "תלמוד",
    };
  });
}

export function TalmudFileTab() {
  const qc = useQueryClient();
  const { hasPermission: canExport, isLoading: permLoading } = useHasPermission("talmud", "export");
  const [done, setDone] = useState(false);
  const query = useQuery({ queryKey: ["portal-talmud-file", done], queryFn: () => fetchItems(done), enabled: canExport });

  if (permLoading) return <LoadingState rows={3} />;
  if (!canExport) return <ErrorState message="אין לך הרשאה ליצוא לתלמוד." />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        תלמידים שנוספו או עזבו דרך הפורטל ואושרו. מורידים קובץ לכל סניף וקולטים אותו בתלמוד ("קליטת תלמידים מקובץ Excel").
        אחרי ההורדה התלמידים עוברים ל"ירדו כבר בקובץ".
      </p>
      <div className="flex gap-2">
        {([false, true] as const).map((v) => (
          <button key={String(v)} onClick={() => setDone(v)}
            className={`rounded-control border px-3 py-1.5 text-sm ${done === v ? "border-brand-600 bg-brand-50 font-semibold text-brand-700" : "border-line text-ink-muted"}`}>
            {v ? "ירדו כבר בקובץ" : "ממתינים לקובץ"}
          </button>
        ))}
      </div>
      {query.isLoading ? <LoadingState rows={3} />
        : query.isError ? <ErrorState message={(query.error as Error).message} />
        : !query.data?.length ? (
          <EmptyState icon={FileSpreadsheet}
            title={done ? "עדיין לא ירד קובץ" : "אין תלמידים שממתינים לקובץ"}
            description={done ? undefined : "תלמיד חדש או תלמיד שעזב, אחרי אישור ב\"ממתין לאישור\", יופיע כאן."} />
        ) : (
          <Sections items={query.data} done={done} onMarked={() => qc.invalidateQueries({ queryKey: ["portal-talmud-file"] })} />
        )}
    </div>
  );
}

function Sections({ items, done, onMarked }: { items: Item[]; done: boolean; onMarked: () => void }) {
  const sections = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) map.set(it.sectionKey, [...(map.get(it.sectionKey) ?? []), it]);
    return [...map.values()].sort((a, b) => a[0].sectionLabel.localeCompare(b[0].sectionLabel, "he"));
  }, [items]);
  return <>{sections.map((list) => <Section key={`${done}-${list[0].sectionKey}`} items={list} done={done} onMarked={onMarked} />)}</>;
}

function Section({ items, done, onMarked }: { items: Item[]; done: boolean; onMarked: () => void }) {
  // ברירת מחדל: כל השורות שאין בהן חוסר. שורה עם חוסר אפשר לסמן ידנית.
  const [selected, setSelected] = useState<Set<string>>(() =>
    new Set(done ? [] : items.filter((i) => i.row && !i.row.missing.length).map((i) => i.request.id)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const missingCount = items.filter((i) => !i.row || i.row.missing.length).length;
  const columns: FilterColumn<Item>[] = [
    { key: "group", text: (i) => i.groupName ?? "" },
    { key: "student", text: (i) => i.studentName },
    { key: "kind", text: (i) => (i.request.kind === "new_student" ? "תלמיד חדש" : "עזב") },
    { key: "date", text: (i) => formatDate(done ? i.request.talmud_file_at : i.request.decided_at), sortValue: (i) => (done ? i.request.talmud_file_at : i.request.decided_at) ?? "" },
    { key: "leader", text: (i) => i.request.leader?.full_name ?? "" },
    { key: "state", text: (i) => (!i.row ? "התלמיד לא נמצא" : i.row.missing.length ? "חסר נתון" : i.row.notes.length ? "לבדיקה" : "תקין") },
  ];
  const ctrl = useColumnFilters(items, columns);
  // רק מה שמוצג עכשיו: אחרי סינון בכותרות, ואחרי סימון חלק מהשורות כבר לא ברשימה
  const chosen = ctrl.rows.filter((i) => selected.has(i.request.id) && i.row);
  const selectable = ctrl.rows.filter((i) => i.row);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const download = async () => {
    if (!chosen.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const data = buildTalmudWorkbook(chosen.map((i) => i.row!));
      const today = new Date().toLocaleDateString("en-CA");
      downloadXls(data, `קליטה לתלמוד - ${items[0].fileLabel} - ${today}.xls`);
      if (!done) {
        const { data: marked, error } = await supabase.rpc("portal_mark_talmud_file", { p_request_ids: chosen.map((i) => i.request.id) });
        if (error) throw error;
        setMessage({ ok: true, text: `הקובץ ירד. ${marked} תלמידים סומנו "ירדו בקובץ".` });
        onMarked();
      } else {
        setMessage({ ok: true, text: "הקובץ ירד שוב." });
      }
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "שגיאה לא צפויה" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-muted px-4 py-3">
        <h3 className="font-semibold">{items[0].sectionLabel}</h3>
        <span className="text-sm text-ink-muted">{items.length} תלמידים{missingCount ? ` · ${missingCount} עם חוסר` : ""}</span>
        <button onClick={download} disabled={busy || !chosen.length} className="btn-primary ms-auto flex items-center gap-2">
          <Download className="h-4 w-4" aria-hidden="true" />
          {busy ? "מכינה…" : `הורדת קובץ לתלמוד (${chosen.length})`}
        </button>
      </header>
      {message && <p className={`px-4 pt-3 text-sm ${message.ok ? "text-ok-ink" : "text-danger-ink"}`}>{message.text}</p>}
      <div className="px-4 pt-3"><ColumnFilterSummary ctrl={ctrl} /></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-right text-ink-muted">
            <tr>
              <th className="px-3 py-2">
                <input type="checkbox" aria-label="בחירת הכול" checked={selectable.length > 0 && chosen.length === selectable.length}
                  onChange={(e) => setSelected(new Set(e.target.checked ? selectable.map((i) => i.request.id) : []))} />
              </th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold"><ColumnHeader ctrl={ctrl} colKey="group">שם קבוצה</ColumnHeader></th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold"><ColumnHeader ctrl={ctrl} colKey="student">תלמיד</ColumnHeader></th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold"><ColumnHeader ctrl={ctrl} colKey="kind">סוג</ColumnHeader></th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold"><ColumnHeader ctrl={ctrl} colKey="date">{done ? "ירד בקובץ" : "אושר"}</ColumnHeader></th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold"><ColumnHeader ctrl={ctrl} colKey="leader">ראש קבוצה</ColumnHeader></th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold"><ColumnHeader ctrl={ctrl} colKey="state">מצב השורה</ColumnHeader></th>
            </tr>
          </thead>
          <tbody>
            {ctrl.rows.map((i) => (
              <tr key={i.request.id} className="border-t border-line align-top">
                <td className="px-3 py-2">
                  <input type="checkbox" disabled={!i.row} checked={selected.has(i.request.id)} onChange={() => toggle(i.request.id)} aria-label={`בחירת ${i.studentName}`} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-semibold">{i.groupName ?? "—"}</td>
                <td className="px-3 py-2">
                  {i.request.student_id ? <Link to={`/ops/students/${i.request.student_id}`} className="link-action">{i.studentName}</Link> : i.studentName}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{i.request.kind === "new_student" ? "תלמיד חדש" : "עזב"}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatDate(done ? i.request.talmud_file_at : i.request.decided_at)}</td>
                <td className="px-3 py-2">{i.request.leader?.full_name ?? "—"}</td>
                <td className="px-3 py-2"><TalmudRowStatus row={i.row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
