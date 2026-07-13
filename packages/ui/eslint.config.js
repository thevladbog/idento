import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  files: ["src/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          { group: ["i18next", "i18next/**", "react-i18next", "react-i18next/**"], message: "@idento/ui is i18n-agnostic — take strings via props." },
          { group: ["axios", "openapi-fetch", "@tanstack/**"], message: "@idento/ui must not fetch data or route." },
          { group: ["**/panel/**", "**/web/**", "**/desktop/**"], message: "@idento/ui must not import from apps." },
        ],
      },
    ],
  },
});
