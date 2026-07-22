import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ops: {
          DEFAULT: "#2563eb",
          light: "#eff6ff",
        },
        finance: {
          DEFAULT: "#065f46",
          light: "#ecfdf5",
        },
        admin: {
          DEFAULT: "#475569",
          light: "#f1f5f9",
        },
        status: {
          critical: "#dc2626",
          high: "#ea580c",
          medium: "#ca8a04",
          ok: "#16a34a",
          neutral: "#6b7280",
        },
      },
      fontFamily: {
        sans: ["Heebo", "Assistant", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
