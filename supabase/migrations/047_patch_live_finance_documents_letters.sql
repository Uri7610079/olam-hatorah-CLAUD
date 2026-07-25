-- Patch לפרויקט החי: צ'ני ביקשה במפורש (אחרי שסקרנו את שלב 13 שוב, בדגש על מנהל
-- הכספים) שמנהל הכספים (finance_controller) יוכל גם ליצור וגם לערוך מסמכי עמותה
-- ומכתבים בעצמו - לא רק לצפות. בכוונה לא הורחב לביקורות משרד החינוך ולא לרשימות
-- בימות המשיח - אלה נשארים כפי שהיו (תפעול בלבד). 044/045 עודכנו בדיסק להתקנה טרייה;
-- זהו ה-patch לפרויקט הקיים.
--
-- בנוסף: עד עכשיו מסך "מסמכים ומכתבים" היה קיים רק תחת הטאב "תפעול שוטף"
-- (/ops/documents) - וכיוון ש-finance_controller מקבל גישה רק לטאב "כספים ובקרה", הוא
-- לא היה רואה את המסך הזה בתפריט שלו בכלל, גם עם ההרשאה הזו. נוסף מסך זהה תחת
-- /finance/documents (קוד, לא DB) כדי שיופיע גם שם.

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'documents' and p.action = 'manage'
where r.key = 'finance_controller'
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.resource = 'letters' and p.action = 'manage'
where r.key = 'finance_controller'
on conflict do nothing;
