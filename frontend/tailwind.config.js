/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'ui-monospace', 'monospace'],
      },
      colors: {
        panel: {
          950: '#0a0c10',
          900: '#0f1117',
          800: '#161b22',
          700: '#21262d',
          600: '#30363d',
        },
      },
    },
  },
  plugins: [],
}
