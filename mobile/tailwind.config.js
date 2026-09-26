/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('nativewind/preset'), require('@pdh/ui/tailwind.preset.cjs')],
  content: ['./App.tsx', '../packages/ui/src/**/*.{ts,tsx}'],
};
