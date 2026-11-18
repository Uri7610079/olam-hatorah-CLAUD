# מפת הדוחות של תלמוד (talmud.edu.gov.il)

נסרק 2026-11-18, עמותת ברכת אלימלך, יחד עם חני (היא נכנסה בעצמה). בלי פרטים אישיים כאן.

## כניסה
- `https://talmud.edu.gov.il/Login.aspx` — שדות "שם משתמש" ו"סיסמה", הכפתור הוא postback של `LoginButton`.
- אחרי הסיסמה: מסך קוד SMS (עוד לא תועד — לתעד במבחן האמת הראשון).
- אחרי הכניסה: `Association/Default.aspx`. כותרת "שלום : <שם> | <עמותה>".
- **החיבור מתנתק מהר** (נותקנו באמצע הסריקה, אחרי כ-10 דקות). המתכון צריך לרוץ ברצף מיד אחרי הכניסה.
- לכל עמותה משתמש, סיסמה ו-SMS משלה.

## איך מורידים דוח (זהה לכל הדוחות)
1. `Reports/ReportResult.aspx` — רשימת דוחות. כל דוח הוא תיבת סימון
   `ContentPlaceHolder1_gvTest_gvReportsList_0_grdRdo_<n>`, ואחריה לוחצים
   `ContentPlaceHolder1_btnReportGenerate` → עובר ל-`Reports/ReportWin.aspx`.
2. ב-ReportWin: SSRS ReportViewer. שדות `ReportViewer1_ctl00_ctlNN_ddValue` (בחירה) או
   `_txtValue` (רב-בחירה, ברירת המחדל = הכל). שדה עם onchange עושה postback (מדורג).
3. "הפק דו"ח" = `ReportViewer1_ctl00_ctl00`.
4. יצוא: `ReportViewer1.ClientController.m_exportUrlBase + <פורמט>` — GET רגיל עם העוגיות.
   פורמטים: `CSV`, `EXCELOPENXML` (xlsx), `PDF` ועוד. **CSV עדיף**: כותרות קבועות באנגלית, UTF-8.
- ברירות מחדל: "כל הסניפים", "כל סוגי לימוד", כל ערכי הרב-בחירה. בדרך כלל צריך לבחור רק חודש.

## הדוחות
| n | דוח | קובץ (FileName) | שדות לבחירה | למשוך |
|---|---|---|---|---|
| 0 | היסטוריה לתלמיד | — | תלמיד אחד | לא |
| 1 | רשימת תלמידים למוסד | (דוח הזכאים, rptStudentsCountByMonth) | ctl11 מחודש, ctl13 עד חודש | כן, חודשי |
| 2 | פירוט סיבות אי זכאות | rptNonEntitlementReasonsDetailed | ctl17 חודש דיווח, ctl21 אמצע/סוף (ברירת מחדל: עדכני ביותר) | כן, חודשי |
| 3 | דרישת תשלום - מפורט לפי תלמיד | (דוח התשלום שכבר נקלט) | חודש דיווח | כן, חודשי |
| 4 | הפקת אישורי לימודים | — | תלמיד אחד | לא |
| 5 | יציאות תלמידים לחו"ל | rptVacationsByInstitute | "הצג חופשות עבור" (שנה) | אופציונלי |
| 6 | תשלומים למוסד | rptInstitutePaymentAll | ctl11 מחודש, ctl13 עד חודש | כן, חודשי |
| 7 | זכאות בעקבות החלטת בג"ץ | rptBagatzSuspended | ctl11 מחודש, ctl13 עד חודש | **כן, חודשי, כל התלמידים** (חני) |
| 8 | הסבר תשלומים וקיזוזים לפי שנה | (rptInstitutePaymentExplanation) | שנת תקציב | כן, לשמור |

בנוסף: תפריט "תלמידים" (`Students/StudentsAllSearch.aspx`) — חיפוש תלמידים עם "יצוא לאקסל"
(קובץ HTML בסיומת xls, כבר נקלט ב-076/086). יש שם כפתורי פעולה ("עזיבת תלמיד",
"עריכת פרטי תלמיד") — **אסור לגעת בהם**.

## כותרות ה-CSV (חודש 10/2026)
- **rptNonEntitlementReasonsDetailed** (576 שורות): `Textbox17` (מוסד נתמך), `Textbox145`
  ("עמותה: <ח.פ>   <שם> סניף NN"), `ReasonLevelName`, `ReasonName`, `ReasonID`, `SuspensionStatus`,
  `StudentStatusName`, `MaritalStatusName`, `GenderName`, `StudentName1`, `StudentFamilyName1`,
  `StudentIdentity`, `IdentityTypeName`, `StudyTypeNumber1`. תלמיד עם כמה סיבות = כמה שורות.
- **rptInstitutePaymentAll** (שורה לסניף ולסוג תשלום): `ReferenceDate`, `תאריך_חישוב`, `ID`,
  `מספר_תלמידים_זכאים`, `סכום_מחושב1`, `סכום_מחושב`, `סוג_תשלום`, `חודש_דיווח`, `סניף`, `שם_עמותה`,
  `ח_פ`, `Textbox52`, `סכום_לתשלום1` ("24,030.00"), `ח_פ1`.
- **rptBagatzSuspended** (שורה לתלמיד, 1,484): `Textbox347` ("חודש: 10/2026"), `Textbox327`
  ("ח.פ.: 580185999-00"), `Textbox93` (שם עמותה), `Textbox336` ("סניף: 00"), `StudyTypeID1`,
  `מספר_זהות_דרכון`, `שם_פרטי`, `שם_משפחה`, `תחילה`, `סיום`, `השעיית_בג_ץ`, `EntitlementStatusID`
  (זכאי/…), `PersonallyEntitled`, `היה_זכאי_אלמלא_השעייה`, `תשלום_חריג`, ושורות סיכום לסניף.
- **rptVacationsByInstitute**: `AssociationNumber`, `AssociationName`, `BranchNumber`,
  `IdentificationTypeName`, `StudentIdentity`, `StudentName`, `StudentFamilyName`, `StudyTypeID`,
  `DateFrom`, `DateTo`, `Comment`, `TotalDays`, `CountedDays`, `Textbox10`.

## אישור לימודים לתלמיד (rptStudyApprovalMultiple)
- ברשימה: "הפקת אישורי לימודים" (n=4). אין שדות בדף הרשימה - הכל ב-ReportWin.
- שדות: עמותה, סניף ("כל הסניפים"), סוג לימוד ("כל סוגי לימוד"), שם תלמיד (נשאר "בחירה לפי תז / דרכון"),
  ומספר הזהות בשדה `ReportViewer1$ctl00$ctl13$txtValue`.
- יצוא PDF = אישור בעמוד אחד (כ-200KB). תלמיד שאינו בעמותה: יצוא CSV עם שורת כותרות בלבד
  (`StudentIdentity1,IdentificationTypeName,...`) - כך מזהים "לא נמצא" בלי לשמור אישור ריק.
- נבדק מול האתר האמיתי 2026-11-18: כ-4 שניות לאישור.
