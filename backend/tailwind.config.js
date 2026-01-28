/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/streamdown/**/*.{js,ts,jsx,tsx}',
    './node_modules/@streamdown/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: '#27272a',
        background: '#09090b',
        foreground: '#fafafa',
        muted: {
          DEFAULT: '#27272a',
          foreground: '#a1a1aa',
        },
      },
    },
  },
  plugins: [],
}

