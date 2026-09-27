/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('nativewind/preset'), require('@pdh/ui/tailwind.preset.cjs')],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../../../packages/ui/src/**/*.{ts,tsx}'],
};
