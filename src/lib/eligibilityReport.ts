import { supabase } from "./supabase";

// האם נקלט דוח זכאות מתלמוד לעמותה ולחודש. "0 זכאים" נכון רק כשנקלט דוח; כשעוד לא
// נקלט - מציגים "טרם נקלט דוח" ולא אפס (ביקורת אינטראקטיבית 20.11, INT-06). אותה
// הבחנה כמו במסך הזכאות: שורות זכאות לחודש, או אצוות זכאות שנקלטה עם החודש הזה.
export async function hasEligibilityReport(orgId: string, month: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("monthly_eligibility")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("month", month);
  if (error) throw error;
  if ((count ?? 0) > 0) return true;
  const profile = await supabase.from("import_profiles").select("id").eq("key", "talmud_eligibility").maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data) return false;
  const start = month.slice(0, 7) + "-01";
  const { count: batches, error: batchErr } = await supabase
    .from("import_batches")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profile.data.id)
    .eq("organization_id", orgId)
    .eq("status", "committed")
    .gte("period_month", start)
    .lt("period_month", nextMonthStart(start));
  if (batchErr) throw batchErr;
  return (batches ?? 0) > 0;
}

// "2026-12-01" -> "2027-01-01". חישוב מחרוזתי, בלי Date ובלי אזור זמן.
export function nextMonthStart(start: string): string {
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
