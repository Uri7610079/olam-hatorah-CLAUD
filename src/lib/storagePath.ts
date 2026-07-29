// מפתח (path) ב-Supabase Storage חייב תווים בטוחים - שם קובץ בעברית (הנורמה אצל
// המשתמשות כאן, לא חריג) שמוטמע ישירות בנתיב גורם לשגיאת "Invalid key" ומפיל את
// ההעלאה כליל. נתפס בפועל בכל מקום שהיה בנוי לפי התבנית הישנה `${uuid}-${file.name}`.
// הפתרון: לא להטמיע את השם המקורי בנתיב בכלל - רק UUID + הסיומת (גם היא רק אחרי
// סינון לתווים לטיניים/ספרות בטוחים). השם המקורי, כשצריך אותו לתצוגה, כבר נשמר בנפרד
// (למשל עמודת file_name/document_name) - זו לא אובדן מידע, רק שינוי איפה הוא נשמר.
export function safeStorageKey(originalName: string): string {
  const match = originalName.match(/\.[a-zA-Z0-9]{1,10}$/);
  const ext = match ? match[0].toLowerCase() : "";
  return `${crypto.randomUUID()}${ext}`;
}
