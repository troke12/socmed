import { defineConfig, globalIgnores } from "eslint/config";
import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/next-env.d.ts",
  ]),
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["eslint.config.mjs"],
    rules: {
      "import/no-anonymous-default-export": "off",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "off",
      // False positive for the async fetch-on-mount pattern: setState runs
      // after `await`, never synchronously inside the effect body.
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default config;
