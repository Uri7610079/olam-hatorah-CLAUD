import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useIsV3 } from "@/lib/uiTheme";

// שדה סיסמה. בערכות הקודמות - אותו <input type="password"> בדיוק כמו קודם.
// ב-v3 נוסף כפתור הצגה/הסתרה, כדי שאפשר יהיה לבדוק מה הוקלד (בעיקר בטלפון).
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const isV3 = useIsV3();
  const [visible, setVisible] = useState(false);

  if (!isV3) return <input type="password" {...props} />;

  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className={`${props.className ?? ""} pl-10`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "הסתרת הסיסמה" : "הצגת הסיסמה"}
        aria-pressed={visible}
        className="absolute inset-y-0 left-0 flex w-10 items-center justify-center text-ink-subtle hover:text-ink"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
