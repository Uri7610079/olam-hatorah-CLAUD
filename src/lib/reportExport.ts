import * as XLSX from "xlsx";
import { supabase } from "./supabase";

// יצוא גנרי לאקסל - אותו דפוס בדיוק כמו buildMasavExportWorkbook (שלב 10), רק לא קשור
// לדומיין ספציפי. כל שדה ב-row הופך לעמודה לפי סדר המפתחות.
export function exportRowsToExcel(rows: Record<string, unknown>[], sheetName: string, fileName: string) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// כל יצוא נרשם ביומן: משתמש (נגזר מה-auth.uid() בפונקציה עצמה), זמן, סוג דוח, מסננים
// והיקף - דרישה מפורשת באפיון (שלב 14). לא חוסם את היצוא אם הרישום נכשל מסיבה כלשהי -
// עדיף שהמשתמש יקבל את הדוח ונאבד רישום יומן, מאשר לחסום דוח תקין בגלל תקלת רישום.
export async function logReportExport(reportType: string, filters: Record<string, unknown>, rowCount: number) {
  try {
    await supabase.rpc("log_report_export", { p_report_type: reportType, p_filters: filters, p_row_count: rowCount });
  } catch {
    // מכוון - ר' הערה למעלה.
  }
}
