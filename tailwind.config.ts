import type { Config } from "tailwindcss";

// Cyan control-room "Jarvis" theme — LOCKED. See rathworkspace-ui skill.
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    // Tremor
    "./node_modules/@tremor/**/*.{js,ts,jsx,tsx,mjs}",
  ],
  theme: {
    extend: {
      colors: {
        // base surfaces
        base: "#0A0A0B",
        panel: "#101013",
        "panel-2": "#15151A",
        border: "#1E1E24",
        // single accent: cyan
        accent: "#06B6D4",
        "accent-dim": "#0E7490",
        "accent-glow": "#22D3EE",
        // text
        "txt-primary": "#E5E7EB",
        "txt-muted": "#9CA3AF",
        "txt-faint": "#6B7280",
        // status
        healthy: "#22C55E",
        warn: "#F59E0B",
        error: "#EF4444",
        off: "#4B5563",
        // Tremor token mapping (dark)
        tremor: {
          brand: {
            faint: "#0B1418",
            muted: "#0E7490",
            subtle: "#0891B2",
            DEFAULT: "#06B6D4",
            emphasis: "#22D3EE",
            inverted: "#0A0A0B",
          },
          background: {
            muted: "#101013",
            subtle: "#15151A",
            DEFAULT: "#0A0A0B",
            emphasis: "#9CA3AF",
          },
          border: { DEFAULT: "#1E1E24" },
          ring: { DEFAULT: "#1E1E24" },
          content: {
            subtle: "#6B7280",
            DEFAULT: "#9CA3AF",
            emphasis: "#E5E7EB",
            strong: "#F9FAFB",
            inverted: "#0A0A0B",
          },
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        panel: "13px",
        inner: "8px",
        "tremor-small": "0.5rem",
        "tremor-default": "0.75rem",
        "tremor-full": "9999px",
      },
      fontSize: {
        "tremor-label": ["0.75rem", { lineHeight: "1rem" }],
        "tremor-default": ["0.875rem", { lineHeight: "1.25rem" }],
        "tremor-title": ["1.125rem", { lineHeight: "1.75rem" }],
        "tremor-metric": ["1.875rem", { lineHeight: "2.25rem" }],
      },
      boxShadow: {
        glow: "0 0 20px rgba(34,211,238,0.25)",
        "glow-sm": "0 0 12px rgba(34,211,238,0.18)",
        "glow-lg": "0 0 40px rgba(34,211,238,0.30)",
        panel: "0 1px 0 0 rgba(255,255,255,0.02) inset, 0 2px 20px rgba(0,0,0,0.4)",
      },
      keyframes: {
        breathe: {
          "0%,100%": { transform: "scale(1)", opacity: "0.85" },
          "50%": { transform: "scale(1.04)", opacity: "1" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "70%": { transform: "scale(1.7)", opacity: "0" },
          "100%": { opacity: "0" },
        },
        "ticker-scroll": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        flash: {
          "0%": { backgroundColor: "rgba(34,211,238,0.25)" },
          "100%": { backgroundColor: "transparent" },
        },
        spin: { to: { transform: "rotate(360deg)" } },
      },
      animation: {
        breathe: "breathe 5s ease-in-out infinite",
        "pulse-ring": "pulse-ring 2.4s cubic-bezier(0.4,0,0.6,1) infinite",
        "ticker-scroll": "ticker-scroll 40s linear infinite",
        "fade-in": "fade-in 0.4s ease-out",
        flash: "flash 1s ease-out",
        "spin-slow": "spin 18s linear infinite",
      },
    },
  },
  safelist: [
    { pattern: /^(bg|text|border|ring|stroke|fill)-(healthy|warn|error|off|accent)/ },
  ],
  plugins: [],
};

export default config;
