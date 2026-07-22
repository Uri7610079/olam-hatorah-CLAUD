# ארכיטקטורה — עולם התורה (Gate 0)

מסמך פנימי למפתח (אני). לא חוזר על האפיון — מתרגם אותו להחלטות טכניות מחייבות. מקור סמכות עסקי: `אפיון_מקצועי_עולם_התורה_V3.docx`. בכל סתירה, האפיון גובר.

## Stack
- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS, RTL מלא (`dir="rtl"` ב-`<html>`, אין תלות ב-Tailwind logical-properties plugin — משתמשים ב-`text-right`/`mr-`/`ml-` בעברית מפורשות כי RTL הוא ברירת המחדל היחידה, לא דו-כיווני).
- **Routing:** react-router-dom, מבנה `/ops/*`, `/finance/*`, `/admin/*`.
- **Server state:** @tanstack/react-query.
- **Forms:** react-hook-form + zod (סכמות משותפות client/server ידנית — Zod רץ גם ב-Edge Functions).
- **Backend:** Supabase (Postgres + Auth + Storage + RLS). אין Supabase CLI/Docker זמינים בסביבה הזו → migrations נכתבים כקבצי SQL ומורצים ידנית ב-Supabase SQL Editor על ידי המשתמש (ראה `supabase/migrations/README.md`).
- **Logic-heavy operations** (חישוב עמלה, commit יבוא, סגירת חודש): פונקציות SQL/PL/pgSQL בתוך migrations, לא Edge Functions בשלב זה — כי אין לי הרצה חיה של Edge Functions בסביבה הזו ללא Supabase CLI. Trade-off מתועד: כשה-CLI יחובר, ניתן להעביר לוגיקה מורכבת ל-Edge Functions בלי לשנות את המודל.

## מבנה תיקיות
```
app/
  ARCHITECTURE.md
  src/
    app/            # routing, layout, providers
    areas/
      ops/           # מסכי תפעול שוטף
      finance/       # מסכי כספים ובקרה
      admin/         # מסכי ניהול
    components/      # Design System: DataTable, StatusBadge, Wizard, MaskedField...
    lib/
      supabase.ts    # client יחיד
      permissions.ts # useHasPermission וכו'
    types/
      db.ts          # טיפוסים שנגזרים מהסכמה (ידני, עד שיהיה CLI לג'נרציה אוטומטית)
  supabase/
    migrations/       # קבצי SQL ממוספרים, בסדר הרצה
      README.md       # הוראות הרצה ידניות ב-SQL Editor
  .env.example
  package.json / vite.config.ts / tailwind.config.ts / tsconfig.json
```

## כללי שמות ונתונים (מ-אפיון V3 §8.1, מחייב)
- טבלאות ועמודות: אנגלית `snake_case`. תוויות ממשק: עברית.
- כל PK: `uuid default gen_random_uuid()`.
- כסף: `numeric(12,2)`. לעולם לא float/real/double.
- מזהים עסקיים (ת"ז, קוד סניף, טלפון, מספר חשבון): `text`, לא `integer`.
- שדות עם ערך מקור+מנורמל: `raw_value text`, `normalized_value text`.
- כל טבלה עסקית: `is_demo boolean not null default false`, `demo_batch_id uuid null`.
- כל טבלה עסקית: `created_at timestamptz not null default now()`, `updated_at timestamptz`.

## סדר Migrations (שלבים 1–17, כל שלב = קובץ SQL אחד או יותר)
תואם ל-Task List שנוצר. מספור קבצים: `NNN_description.sql`, עולה ברצף, לעולם לא נערך migration שכבר "רץ" (רק migration חדש מתקן).

## RLS — עקרון-על
- `alter table X enable row level security;` על **כל** טבלה עסקית, מיד עם היצירה — לא כתוספת מאוחרת.
- פונקציית עזר `has_permission(resource text, action text) returns boolean` — `security definer`, קוראת מטבלת `user_permissions`/`role_permissions` לפי `auth.uid()`.
- ברירת מחדל: אין policy = אין גישה (Postgres RLS deny-by-default כשה-RLS מופעל וללא policy תואמת).
- משתמש `pending` (טרם אושר): policy מפורשת שמאפשרת SELECT רק על שורת ה-profile של עצמו.

## Ledger — עקרון-על (`group_ledger_entries`)
- אין `UPDATE`/`DELETE` — נאכף בטריגר `BEFORE UPDATE OR DELETE ... RAISE EXCEPTION`.
- ייחודיות מקור: `unique (source_type, source_id)` מונעת יצירת רשומה כפולה מאותה פעולה (idempotency).
- יתרה: `view group_balances` = `sum(credit) - sum(debit) group by group_id`. אין עמודת יתרה בשום טבלה.

## מס"ב — עקרון-על
- מכונת מצבים נאכפת ב-`check constraint` + טריגר validation על מעברי סטטוס מותרים בלבד (טבלת מעברים חוקיים).
- `generate_masav_file()` — פונקציה/endpoint שמחזירה שגיאה מפורשת "פורמט טרם אושר" עד קבלת הפורמט האמיתי. לא מיוצג כקובץ תקין.

## סביבות
- **סביבה אחת בשלב זה:** Supabase project יחיד שהמשתמש ייצור (dev/demo משולבים, מסומן `is_demo` ברמת רשומה ולא ברמת סביבה — תואם לעקרון "מערכת אחת, דמו מבודד בדגל" מהאפיון). הפרדת Prod אמיתית תידון בשלב 17.

## מה לא נבנה בשלב זה (Gate 0)
קוד רץ, migrations, UI — אלה מתחילים בשלב 1. Gate 0 הוא תכנון בלבד, בהתאם לעיקרון "Plan mode לפני Build" מהתוכנית.

## החלטות פתוחות מה-Decision Log שאינן חוסמות את הבנייה הטכנית
כל הכללים שאסור לקבע (עמלה, פורמט מס"ב, 90/10, שיוך פעיל יחיד, יותר מחשבון עמותה פעיל) ממומשים כ**מנגנון גמיש + ברירת מחדל כבויה/מוסברת**, לא כ-TODO חסר. פירוט לכל שלב בקוד עצמו (הערת `-- OPEN DECISION:` בכל migration רלוונטי).
