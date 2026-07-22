import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useHasPermission } from "@/lib/permissions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { Organization } from "./types";
import { OrganizationForm, type OrganizationFormValues } from "./OrganizationForm";

interface OrganizationDetailsTabProps {
  organization: Organization;
}

export function OrganizationDetailsTab({ organization }: OrganizationDetailsTabProps) {
  const queryClient = useQueryClient();
  const { hasPermission: canManage } = useHasPermission("organizations", "manage");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);

  const initialValues: OrganizationFormValues = {
    legal_name: organization.legal_name,
    org_number: organization.org_number ?? "",
    contact_phone: organization.contact_phone ?? "",
    contact_email: organization.contact_email ?? "",
    contact_address: organization.contact_address ?? "",
    notes: organization.notes ?? "",
  };

  const handleSave = async (values: OrganizationFormValues) => {
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from("organizations")
      .update({
        legal_name: values.legal_name,
        org_number: values.org_number || null,
        contact_phone: values.contact_phone || null,
        contact_email: values.contact_email || null,
        contact_address: values.contact_address || null,
        notes: values.notes || null,
      })
      .eq("id", organization.id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["organization", organization.id] });
    queryClient.invalidateQueries({ queryKey: ["organizations"] });
  };

  const handleClose = async () => {
    setClosing(true);
    // soft close בלבד - לעולם לא מחיקה של רשומה ששימשה בתהליך.
    const { error } = await supabase.from("organizations").update({ status: "closed" }).eq("id", organization.id);
    setClosing(false);
    setConfirmClose(false);
    if (!error) {
      queryClient.invalidateQueries({ queryKey: ["organization", organization.id] });
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    }
  };

  if (!canManage) {
    return (
      <div className="card max-w-xl space-y-2 p-5 text-sm text-slate-600">
        <p>
          <span className="font-medium text-slate-800">שם משפטי:</span> {organization.legal_name}
        </p>
        <p>
          <span className="font-medium text-slate-800">מספר עמותה:</span> {organization.org_number ?? "—"}
        </p>
        <p>
          <span className="font-medium text-slate-800">טלפון:</span> {organization.contact_phone ?? "—"}
        </p>
        <p>
          <span className="font-medium text-slate-800">אימייל:</span> {organization.contact_email ?? "—"}
        </p>
        <p>
          <span className="font-medium text-slate-800">כתובת:</span> {organization.contact_address ?? "—"}
        </p>
        {organization.notes && (
          <p>
            <span className="font-medium text-slate-800">הערות:</span> {organization.notes}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <OrganizationForm initialValues={initialValues} onSubmit={handleSave} submitLabel="שמירה" submitting={saving} error={error} />

      {organization.status === "active" ? (
        <button onClick={() => setConfirmClose(true)} className="mt-4 text-xs text-red-600 underline hover:text-red-800">
          סגירת עמותה
        </button>
      ) : (
        <p className="mt-4 text-xs text-slate-400">העמותה סגורה.</p>
      )}

      <ConfirmDialog
        open={confirmClose}
        title="סגירת עמותה"
        danger
        confirmLabel={closing ? "סוגרת…" : "סגירה"}
        description="העמותה תסומן כסגורה ולא תוצג ברשימות פעילות. הנתונים וההיסטוריה נשמרים במלואם."
        onCancel={() => setConfirmClose(false)}
        onConfirm={handleClose}
      />
    </div>
  );
}
