// Shared Tailwind preset consumed by both mobile/tailwind.config.js (NativeWind)
// and frontend-web/tailwind.config.js (web). Keep .cjs so it loads as CommonJS
// regardless of the nearest package.json's "type" field.
const tokens = require('./src/theme/tailwind.tokens.cjs');

module.exports = {
  theme: {
    extend: {
      colors: tokens.colors,
      borderRadius: tokens.borderRadius,
      spacing: tokens.spacing,
      fontFamily: tokens.fontFamily,
      fontSize: tokens.fontSize,
    },
  },
};
