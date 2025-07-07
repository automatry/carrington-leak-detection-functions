module.exports = {
  env: {
    es2021: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 2021, // supports optional chaining and other modern syntax
    sourceType: "module",
  },
  extends: [
    "eslint:recommended",
  ],
  rules: {
    // Only basic linting rules
    "no-unused-vars": "warn",
    "no-undef": "warn",
    "no-console": "off",
    "quotes": ["warn", "double", { allowTemplateLiterals: true }],
    "semi": ["warn", "always"],
    "eqeqeq": "warn"
  },
  overrides: [
    {
      files: ["**/*.spec.*"],
      env: {
        mocha: true,
      },
      rules: {},
    },
  ],
  globals: {},
};
