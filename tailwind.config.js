/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./app/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        panel: "rgb(var(--color-panel) / <alpha-value>)",
        elevate: "rgb(var(--color-elevate) / <alpha-value>)",
        primary: "rgb(var(--color-primary) / <alpha-value>)",
        positive: "rgb(var(--color-positive) / <alpha-value>)",
        negative: "rgb(var(--color-negative) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)"
      },
      boxShadow: {
        soft: "0 20px 60px rgba(3, 7, 18, 0.45)"
      }
    }
  },
  plugins: []
};
