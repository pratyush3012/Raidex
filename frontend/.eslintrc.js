module.exports = {
  extends: ["expo"],
  ignorePatterns: ["dist/*", "coverage/*", ".expo/*"],
  overrides: [
    {
      files: ["jest.setup.js", "**/*.test.ts", "**/*.test.tsx"],
      env: { jest: true, node: true },
    },
    {
      files: ["metro.config.js", "babel.config.js", "scripts/**/*.js"],
      env: { node: true },
    },
  ],
};
