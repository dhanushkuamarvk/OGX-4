import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0b0d12",
        foreground: "#f3f5f8",
        surface: {
          DEFAULT: "#131620",
          elevated: "#1a1e2b",
          hover: "#222738",
        },
        border: {
          DEFAULT: "rgba(255, 255, 255, 0.08)",
          subtle: "rgba(255, 255, 255, 0.06)",
          strong: "rgba(255, 255, 255, 0.14)",
        },
        accent: {
          violet: "#8b7cf6",
          purple: "#8b7cf6",
          lavender: "#a79bf9",
          cyan: "#56ccf2",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        subtle: "0 1px 2px rgba(0, 0, 0, 0.35), 0 6px 20px rgba(0, 0, 0, 0.22)",
        card: "0 1px 2px rgba(0, 0, 0, 0.28), 0 4px 14px rgba(0, 0, 0, 0.18)",
        toast: "0 10px 32px rgba(0, 0, 0, 0.45)",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fadeIn 180ms ease-out",
        "slide-up": "slideUp 200ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
