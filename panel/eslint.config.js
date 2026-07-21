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
  reactHooks.configs["recommended-latest"],
  reactRefresh.configs.vite,
  jsxA11y.flatConfigs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
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
);
