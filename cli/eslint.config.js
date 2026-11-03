const js = require('@eslint/js');
const typescript = require('@typescript-eslint/eslint-plugin');
const parser = require('@typescript-eslint/parser');
const globals = require('globals');

module.exports = [
  {linterOptions: {reportUnusedDisableDirectives: false}},
  {ignores: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.js', '**/*.d.ts', '__tests__/**']},
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {...globals.node, ...globals.es2020},
      parser,
      parserOptions: {project: './tsconfig.json', tsconfigRootDir: __dirname},
    },
    plugins: {'@typescript-eslint': typescript},
    rules: {
      // Pin the previous recommended rule set so the security upgrade preserves the ratchet.
      ...js.configs.recommended.rules,
      'no-constant-condition': ['error', {checkLoops: true}],
      ...typescript.configs['eslint-recommended'].overrides[0].rules,
      ...typescript.configs.recommended.rules,
      ...typescript.configs['recommended-requiring-type-checking'].rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_"
        }
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "no-console": [
        "warn",
        {
          "allow": [
            "warn",
            "error"
          ]
        }
      ],
      "prefer-const": "error",
      "no-var": "error",
      "eqeqeq": [
        "error",
        "always"
      ],
      "curly": [
        "error",
        "all"
      ],
      "no-throw-literal": "error"
    },
  },
];
