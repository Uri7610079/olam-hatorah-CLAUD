import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ScanSearch } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/ErrorState";

interface OrgOption {
  id: string;
  legal_name: string;
}

interface BankAccountOption {
  id: string;
  bank_name: string | null;
  account_number_masked: string | null;
}

interface TransactionType {
  id: string;
  code: string;
  label_he: string;
}

type Direction = "debit" | "credit";
type TextMatchType = "contains" | "starts_with";
type Confidence = "high" | "medium" | "low";

interface RuleRow {
  id: string;
  organization_bank_account_id: string | null;
  direction: Direction | null;
  text_match_type: TextMatchType | null;
  text_match_value: string | null;
  counterparty_name: string | null;
  amount_min: number | null;
  amount_max: number | null;
  reference_match: string | null;
  effective_from: string | null;
  effective_until: string | null;
  confidence_level: Confidence;
  priority: number;
  is_active: boolean;
  suggested_type: { label_he: string } | null;
  account: { bank_name: string | null; account_number_masked: string | null } | null;
}

const DIRECTION_LABEL: Record<Direction, string> = { debit: "חובה", credit: "זכות" };
const TEXT_MATCH_LABEL: Record<TextMatchType, string> = { contains: "מכיל", starts_with: "מתחיל ב" };
const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "גבוהה", medium: "בינונית", low: "נמוכה" };

async function fetchOrgs(): Promise<OrgOption[]> {
  const { data, error } = await supabase.from("organizations").select("id, legal_name").eq("status", "active").order("legal_name");
  if (error) throw error;
  return data ?? [];
}

async function fetchOrgBankAccounts(orgId: string): Promise<BankAccountOption[]> {
  const { data, error } = await supabase
    .from("organization_bank_accounts_view")
    .select("id, bank_name, account_number_masked")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (error) throw error;
  return data ?? [];
}

async function fetchTransactionTypes(): Promise<TransactionType[]> {
  const { data, error } = await supabase.from("bank_transaction_types").select("id, code, label_he").eq("is_active", true).order("label_he");
  if (error) throw error;
  return data ?? [];
}

async function fetchRules(): Promise<RuleRow[]> {
  const { data, error } = await supabase
    .from("recognition_rules")
    .select(
      "id, organization_bank_account_id, direction, text_match_type, text_match_value, counterparty_name, amount_min, amount_max, reference_match, effective_from, effective_until, confidence_level, priority, is_active, suggested_type:bank_transaction_types(label_he), account:organization_bank_accounts_view(bank_name, account_number_masked)",
    )
    .order("priority", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...r,
    suggested_type: Array.isArray(r.suggested_type) ? (r.suggested_type[0] ?? null) : r.suggested_type,
    account: Array.isArray(r.account) ? (r.account[0] ?? null) : r.account,
  }));
}

const EMPTY_FORM = {
  orgId: "",
  bankAccountId: "",
  direction: "" as Direction | "",
  textMatchType: "" as TextMatchType | "",
  textMatchValue: "",
  counterpartyName: "",
  amountMin: "",
  amountMax: "",
  referenceMatch: "",
  effectiveFrom: "",
  effectiveUntil: "",
  suggestedTypeId: "",
  confidenceLevel: "medium" as Confidence,
  priority: "0",
};

export function RecognitionRulesScreen() {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("transaction_classification", "perform");
  const orgsQuery = useQuery({ queryKey: ["organizations-active"], queryFn: fetchOrgs });
  const typesQuery = useQuery({ queryKey: ["bank-transaction-types-active"], queryFn: fetchTransactionTypes });
  const rulesQuery = useQuery({ queryKey: ["recognition-rules"], queryFn: fetchRules });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bankAccountsQuery = useQuery({ queryKey: ["recognition-org-accounts", form.orgId], queryFn: () => fetchOrgBankAccounts(form.orgId), enabled: !!form.orgId });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["recognition-rules"] });

  const toNum = (v: string) => (v.trim() === "" ? null : Number(v));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.suggestedTypeId) return;
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.from("recognition_rules").insert({
      organization_bank_account_id: form.bankAccountId || null,
      direction: form.direction || null,
      text_match_type: form.textMatchValue ? form.textMatchType || "contains" : null,
      text_match_value: form.textMatchValue || null,
      counterparty_name: form.counterpartyName || null,
      amount_min: toNum(form.amountMin),
      amount_max: toNum(form.amountMax),
      reference_match: form.referenceMatch || null,
      effective_from: form.effectiveFrom || null,
      effective_until: form.effectiveUntil || null,
      suggested_type_id: form.suggestedTypeId,
      confidence_level: form.confidenceLevel,
      priority: Number(form.priority) || 0,
    });
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setForm(EMPTY_FORM);
    setShowAdd(false);
    refresh();
  };

  const toggleActive = async (rule: RuleRow) => {
    await supabase.from("recognition_rules").update({ is_active: !rule.is_active }).eq("id", rule.id);
    refresh();
  };

  const columns: DataTableColumn<RuleRow>[] = [
    {
      key: "scope",
      header: "חשבון",
      render: (r) => (r.account ? `${r.account.bank_name ?? "בנק"} · ${r.account.account_number_masked}` : "כל החשבונות"),
    },
    {
      key: "criteria",
      header: "קריטריונים",
      render: (r) =>
        [
          r.direction ? DIRECTION_LABEL[r.direction] : null,
          r.text_match_type && r.text_match_value ? `${TEXT_MATCH_LABEL[r.text_match_type]} "${r.text_match_value}"` : null,
          r.counterparty_name ? `גורם: ${r.counterparty_name}` : null,
          r.amount_min != null || r.amount_max != null ? `סכום: ${r.amount_min ?? "—"}–${r.amount_max ?? "—"}` : null,
          r.reference_match ? `אסמכתה: ${r.reference_match}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "ללא הגבלה",
    },
    { key: "type", header: "סוג מוצע", render: (r) => r.suggested_type?.label_he ?? "—" },
    { key: "confidence", header: "רמת ביטחון", render: (r) => CONFIDENCE_LABEL[r.confidence_level] },
    { key: "priority", header: "עדיפות", className: "tabular", render: (r) => r.priority },
    {
      key: "status",
      header: "סטטוס",
      render: (r) =>
        canManage ? (
          <button onClick={() => toggleActive(r)} className="link-action text-xs">
            <StatusBadge severity={r.is_active ? "ok" : "neutral"} label={r.is_active ? "פעיל" : "כבוי"} />
          </button>
        ) : (
          <StatusBadge severity={r.is_active ? "ok" : "neutral"} label={r.is_active ? "פעיל" : "כבוי"} />
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="כללי זיהוי בנק"
        description="הצעת סיווג בלבד - לעולם לא אישור אוטומטי. כשכמה כללים תואמים לאותה תנועה, מנצחת העדיפות הגבוהה ביותר."
        primaryAction={
          canManage && (
            <button onClick={() => setShowAdd((v) => !v)} className="btn-primary">
              {showAdd ? "סגירה" : "כלל חדש"}
            </button>
          )
        }
      />

      {showAdd && (
        <form onSubmit={submit} className="card mb-6 max-w-4xl space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">עמותה (לצורך בחירת חשבון)</label>
              <select value={form.orgId} onChange={(e) => setForm((f) => ({ ...f, orgId: e.target.value, bankAccountId: "" }))} className="input-field">
                <option value="">— בחרי —</option>
                {(orgsQuery.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.legal_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">חשבון (לא חובה - ריק = כל החשבונות)</label>
              <select value={form.bankAccountId} onChange={(e) => setForm((f) => ({ ...f, bankAccountId: e.target.value }))} className="input-field" disabled={!form.orgId}>
                <option value="">— כל החשבונות —</option>
                {(bankAccountsQuery.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.bank_name ?? "בנק"} · {a.account_number_masked}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">צד (לא חובה)</label>
              <select value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value as Direction | "" }))} className="input-field">
                <option value="">— כל הצדדים —</option>
                <option value="debit">חובה</option>
                <option value="credit">זכות</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">סוג התאמת טקסט</label>
              <select value={form.textMatchType} onChange={(e) => setForm((f) => ({ ...f, textMatchType: e.target.value as TextMatchType | "" }))} className="input-field">
                <option value="contains">מכיל</option>
                <option value="starts_with">מתחיל ב</option>
              </select>
            </div>
            <div>
              <label className="field-label">ערך טקסט להתאמה בתיאור (לא חובה)</label>
              <input value={form.textMatchValue} onChange={(e) => setForm((f) => ({ ...f, textMatchValue: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">שם גורם (לא חובה)</label>
              <input value={form.counterpartyName} onChange={(e) => setForm((f) => ({ ...f, counterpartyName: e.target.value }))} className="input-field" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">סכום מינימום (לא חובה)</label>
              <input type="number" step="0.01" value={form.amountMin} onChange={(e) => setForm((f) => ({ ...f, amountMin: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">סכום מקסימום (לא חובה)</label>
              <input type="number" step="0.01" value={form.amountMax} onChange={(e) => setForm((f) => ({ ...f, amountMax: e.target.value }))} className="input-field tabular" />
            </div>
            <div>
              <label className="field-label">התאמת אסמכתה (לא חובה)</label>
              <input value={form.referenceMatch} onChange={(e) => setForm((f) => ({ ...f, referenceMatch: e.target.value }))} className="input-field" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">בתוקף מתאריך (לא חובה)</label>
              <input type="date" value={form.effectiveFrom} onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">בתוקף עד (לא חובה)</label>
              <input type="date" value={form.effectiveUntil} onChange={(e) => setForm((f) => ({ ...f, effectiveUntil: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="field-label">עדיפות (מספר גבוה יותר מנצח)</label>
              <input type="number" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} className="input-field tabular" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">סוג תנועה מוצע</label>
              <select required value={form.suggestedTypeId} onChange={(e) => setForm((f) => ({ ...f, suggestedTypeId: e.target.value }))} className="input-field">
                <option value="">— בחרי —</option>
                {(typesQuery.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label_he}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">רמת ביטחון</label>
              <select value={form.confidenceLevel} onChange={(e) => setForm((f) => ({ ...f, confidenceLevel: e.target.value as Confidence }))} className="input-field">
                {(Object.keys(CONFIDENCE_LABEL) as Confidence[]).map((c) => (
                  <option key={c} value={c}>
                    {CONFIDENCE_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <ErrorState message={error} />}
          <button type="submit" disabled={submitting || !form.suggestedTypeId} className="btn-primary">
            {submitting ? "שומרת…" : "שמירת כלל"}
          </button>
        </form>
      )}

      <DataTable columns={columns} rows={rulesQuery.data ?? []} rowKey={(r) => r.id} loading={rulesQuery.isLoading} emptyTitle="אין כללי זיהוי" emptyIcon={ScanSearch} />
    </div>
  );
}
