// הסקריפט "npm run lint" היה קיים, אבל בלי קובץ הגדרות ESLint נכשל מיד -
// כלומר לא רץ אף פעם. הכללים כאן הם אלה שתופסים באגים ממשיים (hooks
// מותנים, תלויות חסרות ב-useEffect, מפתחות כפולים), ולא סגנון.
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  plugins: ["react-hooks", "@typescript-eslint"],
  ignorePatterns: ["dist", "node_modules", "api", "*.cjs"],
  rules: {
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    "no-dupe-keys": "error",
    "no-dupe-else-if": "error",
    "no-duplicate-case": "error",
    "no-self-compare": "error",
    "no-unreachable": "error",
    "no-constant-condition": ["error", { checkLoops: false }],
    "no-cond-assign": "error",
    "use-isnan": "error",
    "valid-typeof": "error",
    "no-sparse-arrays": "error",
    "no-unsafe-finally": "error",
    "no-async-promise-executor": "error",
    "no-self-assign": "error",
  },
};
