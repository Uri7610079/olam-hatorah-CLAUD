import type { Config } from "tailwindcss";

// כל הצבעים מצביעים לאסימוני CSS (ר' src/index.css) ולא לערכים קשיחים - כך
// שהחלפת ערכת העיצוב (data-ui) משנה את כל המערכת בלי לגעת באף קומפוננטה.
// סקאלת brand-* נשארת באותם שמות שכבר בשימוש בקוד, רק שהערכים מגיעים מאסימון.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "rgb(var(--ui-brand-50) / <alpha-value>)",
          100: "rgb(var(--ui-brand-100) / <alpha-value>)",
          200: "rgb(var(--ui-brand-200) / <alpha-value>)",
          300: "rgb(var(--ui-brand-300) / <alpha-value>)",
          400: "rgb(var(--ui-brand-400) / <alpha-value>)",
          500: "rgb(var(--ui-brand-500) / <alpha-value>)",
          600: "rgb(var(--ui-brand-600) / <alpha-value>)",
          700: "rgb(var(--ui-brand-700) / <alpha-value>)",
          800: "rgb(var(--ui-brand-800) / <alpha-value>)",
          900: "rgb(var(--ui-brand-900) / <alpha-value>)",
        },

        // אסימונים סמנטיים - השמות מתארים תפקיד, לא גוון.
        app: "rgb(var(--ui-app-bg) / <alpha-value>)",
        surface: {
          DEFAULT: "rgb(var(--ui-surface) / <alpha-value>)",
          muted: "rgb(var(--ui-surface-muted) / <alpha-value>)",
        },
        line: {
          DEFAULT: "rgb(var(--ui-border) / <alpha-value>)",
          strong: "rgb(var(--ui-border-strong) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--ui-ink) / <alpha-value>)",
          muted: "rgb(var(--ui-ink-muted) / <alpha-value>)",
          subtle: "rgb(var(--ui-ink-subtle) / <alpha-value>)",
        },

        // צבע האזור הפעיל - נקבע ע"י data-area על <html> (ר' Layout).
        area: {
          DEFAULT: "rgb(var(--ui-area) / <alpha-value>)",
          soft: "rgb(var(--ui-area-soft) / <alpha-value>)",
        },
        "area-ops": { DEFAULT: "rgb(var(--ui-area-ops) / <alpha-value>)", soft: "rgb(var(--ui-area-ops-soft) / <alpha-value>)" },
        "area-finance": { DEFAULT: "rgb(var(--ui-area-finance) / <alpha-value>)", soft: "rgb(var(--ui-area-finance-soft) / <alpha-value>)" },
        "area-admin": { DEFAULT: "rgb(var(--ui-area-admin) / <alpha-value>)", soft: "rgb(var(--ui-area-admin-soft) / <alpha-value>)" },
        "area-tasks": { DEFAULT: "rgb(var(--ui-area-tasks) / <alpha-value>)", soft: "rgb(var(--ui-area-tasks-soft) / <alpha-value>)" },

        ok: { DEFAULT: "rgb(var(--ui-ok) / <alpha-value>)", soft: "rgb(var(--ui-ok-soft) / <alpha-value>)", ink: "rgb(var(--ui-ok-ink) / <alpha-value>)" },
        warn: { DEFAULT: "rgb(var(--ui-warn) / <alpha-value>)", soft: "rgb(var(--ui-warn-soft) / <alpha-value>)", ink: "rgb(var(--ui-warn-ink) / <alpha-value>)" },
        danger: { DEFAULT: "rgb(var(--ui-danger) / <alpha-value>)", soft: "rgb(var(--ui-danger-soft) / <alpha-value>)", ink: "rgb(var(--ui-danger-ink) / <alpha-value>)" },
        info: { DEFAULT: "rgb(var(--ui-info) / <alpha-value>)", soft: "rgb(var(--ui-info-soft) / <alpha-value>)", ink: "rgb(var(--ui-info-ink) / <alpha-value>)" },
        neutral: { DEFAULT: "rgb(var(--ui-neutral) / <alpha-value>)", soft: "rgb(var(--ui-neutral-soft) / <alpha-value>)", ink: "rgb(var(--ui-neutral-ink) / <alpha-value>)" },

        // שמות האזורים הישנים - נשמרים כדי שקוד קיים שעדיין משתמש בהם ימשיך
        // לעבוד ויתחלף עם הערכה. יוסרו כשכל המסכים יעברו לאסימונים.
        ops: { DEFAULT: "rgb(var(--ui-area-ops) / <alpha-value>)", light: "rgb(var(--ui-area-ops-soft) / <alpha-value>)" },
        finance: { DEFAULT: "rgb(var(--ui-area-finance) / <alpha-value>)", light: "rgb(var(--ui-area-finance-soft) / <alpha-value>)" },
        admin: { DEFAULT: "rgb(var(--ui-area-admin) / <alpha-value>)", light: "rgb(var(--ui-area-admin-soft) / <alpha-value>)" },
        tasks: { DEFAULT: "rgb(var(--ui-area-tasks) / <alpha-value>)", light: "rgb(var(--ui-area-tasks-soft) / <alpha-value>)" },

        status: {
          critical: "rgb(var(--ui-danger) / <alpha-value>)",
          high: "rgb(var(--ui-warn) / <alpha-value>)",
          medium: "rgb(var(--ui-warn) / <alpha-value>)",
          ok: "rgb(var(--ui-ok) / <alpha-value>)",
          neutral: "rgb(var(--ui-neutral) / <alpha-value>)",
        },
      },
      borderRadius: {
        card: "var(--ui-radius-card)",
        control: "var(--ui-radius-control)",
      },
      boxShadow: {
        card: "var(--ui-shadow-card)",
      },
      fontFamily: {
        sans: ["Heebo", "Assistant", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
