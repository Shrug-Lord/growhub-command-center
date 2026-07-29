export default {
  printWidth: 100,
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
  overrides: [
    {
      files: ['deploy/server/**/*.js'],
      options: { semi: true },
    },
  ],
}
