// שם קבוצה עם הסניף שלה. בעמותה אחת יכולות להיות כמה קבוצות באותו שם (למשל שלוש
// "רוטנברג" בסניפים שונים), ובבחירה כספית אי אפשר להבחין ביניהן בלי הסניף
// (ביקורת אינטראקטיבית 20.11, INT-03). הערך שנבחר נשאר תמיד המזהה הפנימי.
export interface GroupBranchInfo {
  internal_name?: string | null;
  talmud_branch_code?: string | null;
}

export function groupLabel(name: string, branch: GroupBranchInfo | GroupBranchInfo[] | null | undefined): string {
  const b = Array.isArray(branch) ? branch[0] : branch;
  const code = (b?.talmud_branch_code ?? "").trim();
  const internal = (b?.internal_name ?? "").trim();
  const branchText = code ? `סניף ${code}` : internal;
  return branchText ? `${name} · ${branchText}` : name;
}
