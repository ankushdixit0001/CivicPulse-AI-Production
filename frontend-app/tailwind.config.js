/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: '#0b1220',
        accent: '#36d399',
        warn: '#fbbf24',
        critical: '#ef4444',
      },
      boxShadow: {
        glass: '0 10px 30px rgba(15, 23, 42, 0.45)',
      },
    },
  },
  plugins: [],
};
