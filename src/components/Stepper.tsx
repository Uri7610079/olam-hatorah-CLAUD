export interface StepDef {
  key: string;
  label: string;
}

interface StepperProps {
  steps: StepDef[];
  currentStep: string;
}

// אינדיקטור שלבים ויזואלי בלבד. הלוגיקה של מעבר בין שלבים (ולידציה, שמירת טיוטה)
// נשארת אצל צרכן הרכיב — למשל אשף קליטת תלמיד (שלב 4) או אשף יבוא (שלב 5).
export function Stepper({ steps, currentStep }: StepperProps) {
  const currentIndex = steps.findIndex((s) => s.key === currentStep);
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-2" aria-label="שלבי תהליך">
      {steps.map((step, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              aria-current={state === "current" ? "step" : undefined}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium transition ${
                state === "done"
                  ? "bg-brand-600 text-white"
                  : state === "current"
                    ? "border-2 border-brand-600 text-brand-700"
                    : "border border-slate-300 text-slate-400"
              }`}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <span className={`text-sm ${state === "upcoming" ? "text-slate-400" : "text-slate-700"}`}>
              {step.label}
            </span>
            {i < steps.length - 1 && <span aria-hidden="true" className="mx-1 h-px w-6 bg-slate-200" />}
          </li>
        );
      })}
    </ol>
  );
}
