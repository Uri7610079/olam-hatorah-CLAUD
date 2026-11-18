import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchAllIn } from "@/lib/fetchAll";
import { ErrorState } from "@/components/ErrorState";
import { parseIds } from "@/lib/talmudPull";

// אישורי לימודים מתלמוד (מיגרציה 119): מדביקים רשימת מספרי ת.ז., המערכת מוצאת
// לכל תלמיד את העמותה שלו, נכנסת לתלמוד בשם העמותה (סיסמה שמורה + SMS), ומורידה
// לכל אחד את האישור כ-PDF. ההתקדמות וקוד ה-SMS - בלשונית "משיכה", וכל אישור נשמר
// בתיקיית ההורדות ברגע שהוא מגיע.

interface Org { organization_id: string; legal_name: string; username: string | null; has_password: boolean }

interface Row {
  externalId: string;
  name: string | null;
  orgId: string | null;
  orgName: string | null;
}

const stripZeros = (s: string) => s.replace(/^0+/, "");

async function findStudents(ids: string[]): Promise<Row[]> {
  // אפס מוביל: "012345678" ו-"12345678" הם אותו תלמיד
  const variants = [...new Set(ids.flatMap((id) => [id, stripZeros(id), /^\d+$/.test(id) ? id.padStart(9, "0") : id]))];
  const found = await fetchAllIn(variants, (chunk) => supabase.from("students")
    .select("external_id, full_name, assignment:student_assignments(is_active, organization:organizations(id, legal_name))")
    .in("external_id", chunk).order("id"));
  const byKey = new Map<string, { full_name: string; org: { id: string; legal_name: string } | null }>();
  for (const s of found as unknown as { external_id: string; full_name: string; assignment: { is_active: boolean; organization: { id: string; legal_name: string } | { id: string; legal_name: string }[] | null }[] }[]) {
    const active = (s.assignment ?? []).find((a) => a.is_active);
    const org = active ? (Array.isArray(active.organization) ? active.organization[0] : active.organization) : null;
    byKey.set(stripZeros(s.external_id), { full_name: s.full_name, org: org ?? null });
  }
  return ids.map((id) => {
    const s = byKey.get(stripZeros(id));
    return { externalId: id, name: s?.full_name ?? null, orgId: s?.org?.id ?? null, orgName: s?.org?.legal_name ?? null };
  });
}

export function TalmudCertificatesTab({ onStarted }: { onStarted: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fallbackOrg, setFallbackOrg] = useState("");

  const orgs = useQuery({
    queryKey: ["talmud-credentials"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("talmud_credentials_list");
      if (error) throw error;
      return (data ?? []) as Org[];
    },
  });
  const withUser = new Set((orgs.data ?? []).filter((o) => o.username && o.has_password).map((o) => o.organization_id));

  const check = useMutation({
    mutationFn: () => findStudents(parseIds(text)),
    onSuccess: setRows,
  });

  // מי יוריד: תלמיד עם עמותה (שיש לה משתמש תלמוד), ותלמיד שלא במערכת - לפי העמותה שנבחרה לו
  const items = (rows ?? []).flatMap((r) => {
    const org = r.orgId ?? (fallbackOrg || null);
    return org && withUser.has(org) ? [{ organization_id: org, external_id: r.externalId, name: r.name ?? "" }] : [];
  });
  const unknown = (rows ?? []).filter((r) => !r.orgId);
  const noUser = (rows ?? []).filter((r) => r.orgId && !withUser.has(r.orgId));

  const start = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("talmud_start_certificates", { p_items: items });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["talmud-pull-status"] });
      setRows(null);
      setText("");
      onStarted();
    },
  });

  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-sm text-ink-muted">
        מדביקים מספרי תעודת זהות או דרכון - שורה לכל תלמיד, או עמודה שמעתיקים מאקסל. המערכת מוצאת לכל תלמיד את העמותה שלו,
        נכנסת לתלמוד בשם העמותה, ומורידה את אישור הלימודים כקובץ PDF לתיקיית ההורדות.
      </p>
      <div>
        <label htmlFor="cert-ids" className="field-label">מספרי זהות</label>
        <textarea
          id="cert-ids"
          value={text}
          onChange={(e) => { setText(e.target.value); setRows(null); }}
          rows={6}
          dir="ltr"
          className="input-field font-mono"
          placeholder={"206309957\n321616146"}
        />
        <p className="mt-1 text-xs text-ink-subtle">{parseIds(text).length} מספרים</p>
      </div>
      <button onClick={() => check.mutate()} disabled={!parseIds(text).length || check.isPending} className="btn-secondary flex items-center gap-2">
        <Search className="h-4 w-4" aria-hidden="true" />
        {check.isPending ? "בודק…" : "בדיקת הרשימה"}
      </button>
      {check.isError && <ErrorState message={check.error instanceof Error ? check.error.message : "שגיאה"} />}

      {rows && (
        <section className="space-y-3">
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-right text-ink-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">מספר זהות</th>
                  <th className="px-3 py-2 font-semibold">שם</th>
                  <th className="px-3 py-2 font-semibold">עמותה</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.externalId} className="border-t border-line">
                    <td className="px-3 py-2 tabular" dir="ltr">{r.externalId}</td>
                    <td className="px-3 py-2">{r.name ?? <span className="text-warn-ink">לא נמצא במערכת</span>}</td>
                    <td className="px-3 py-2">
                      {r.orgName
                        ? <>{r.orgName}{!withUser.has(r.orgId!) && <span className="text-danger-ink"> · אין משתמש תלמוד שמור</span>}</>
                        : <span className="text-ink-subtle">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {unknown.length > 0 && (
            <div className="rounded-control bg-warn-soft p-3 text-sm text-warn-ink">
              <p>{unknown.length === 1 ? "מספר אחד לא נמצא" : `${unknown.length} מספרים לא נמצאו`} במערכת. אפשר לחפש {unknown.length === 1 ? "אותו" : "אותם"} בתלמוד בעמותה:</p>
              <select value={fallbackOrg} onChange={(e) => setFallbackOrg(e.target.value)} className="input-field mt-2 w-64">
                <option value="">— לדלג עליהם —</option>
                {(orgs.data ?? []).filter((o) => withUser.has(o.organization_id)).map((o) => (
                  <option key={o.organization_id} value={o.organization_id}>{o.legal_name}</option>
                ))}
              </select>
            </div>
          )}
          {noUser.length > 0 && (
            <p className="text-sm text-danger-ink">
              ל-{noUser.length} תלמידים אין משתמש תלמוד שמור לעמותה שלהם, והם לא יורדו. מגדירים בלשונית "משתמשי תלמוד".
            </p>
          )}

          {start.isError && <ErrorState message={start.error instanceof Error ? start.error.message : String((start.error as { message?: string })?.message ?? "שגיאה")} />}
          <button onClick={() => start.mutate()} disabled={!items.length || start.isPending} className="btn-primary flex items-center gap-2">
            <FileText className="h-4 w-4" aria-hidden="true" />
            {start.isPending ? "מתחיל…" : `הורדת אישורי לימודים (${items.length})`}
          </button>
          <p className="text-xs text-ink-subtle">
            בפעם הראשונה הדפדפן ישאל אם לאפשר הורדה של כמה קבצים - לאשר.
          </p>
        </section>
      )}
    </div>
  );
}
