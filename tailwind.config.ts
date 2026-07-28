import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
        },
        ops: {
          DEFAULT: "#4f46e5",
          light: "#eef2ff",
        },
        finance: {
          DEFAULT: "#065f46",
          light: "#ecfdf5",
        },
        admin: {
          DEFAULT: "#475569",
          light: "#f1f5f9",
        },
        tasks: {
          DEFAULT: "#b45309",
          light: "#fffbeb",
        },
        status: {
          critical: "#dc2626",
          high: "#ea580c",
          medium: "#ca8a04",
          ok: "#16a34a",
          neutral: "#6b7280",
        },
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 6px -1px rgb(15 23 42 / 0.06)",
      },
      fontFamily: {
        sans: ["Heebo", "Assistant", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
