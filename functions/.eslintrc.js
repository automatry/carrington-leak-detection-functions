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
    // Reduced restrictions
    "no-restricted-globals": "off",
    "prefer-arrow-callback": "warn",
    "quotes": ["warn", "double", { allowTemplateLiterals: true }],
    "linebreak-style": "off",
    "no-trailing-spaces": "warn",
    "indent": ["warn", 2],
    "object-curly-spacing": ["warn", "always"],
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
