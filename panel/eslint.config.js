import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "public", "src/shared/api/schema.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"],
  reactRefresh.configs.vite,
  jsxA11y.flatConfigs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // react-hooks v7 compiler rules at full severity: the burn-down
      // resolved every finding (real refactors or a justified inline
      // disable), so any new one is a genuine regression.
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/refs": "error",
      "react-hooks/preserve-manual-memoization": "error",
      "react-hooks/immutability": "error",
      "react-hooks/globals": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "JSXOpeningElement[name.name='select']", message: "Use @idento/ui Select, not a native <select>." },
        { selector: "JSXOpeningElement[name.name='option']", message: "Use @idento/ui SelectItem, not <option>." },
        { selector: "JSXOpeningElement[name.name='optgroup']", message: "Use @idento/ui SelectGroup/SelectLabel, not <optgroup>." },
        { selector: "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value=/^(checkbox|radio)$/]", message: "Use @idento/ui Checkbox / RadioGroup, not <input type=\"checkbox\"|\"radio\">." },
        { selector: "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value='date']", message: "Use @idento/ui DatePicker, not <input type=\"date\">." },
        { selector: "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value='number']", message: "Use @idento/ui NumberInput, not <input type=\"number\">." },
      ],
    },
  },
  // Test files: the compiler rules target production components; tests
  // legitimately reassign captured variables (MSW handlers, spies) and
  // define throwaway components.
  {
    files: ["src/**/*.test.{ts,tsx}", "src/test/**", "e2e/**"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/immutability": "off",
      "react-hooks/globals": "off",
    },
  },
);
