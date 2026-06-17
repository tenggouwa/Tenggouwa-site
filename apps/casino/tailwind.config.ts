import type { Config } from 'tailwindcss';

// 终端霓虹 Hybrid：沿用主站 terminal-* 色板与 mono 字体，叠加更亮的霓虹强调与发光。
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  corePlugins: {
    preflight: true,
  },
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        terminal: {
          bg: '#0b0f10',
          panel: '#11181c',
          line: '#1f2a30',
          green: '#5af78e',
          cyan: '#57c7ff',
          yellow: '#f3f99d',
          pink: '#ff6ac1',
          gray: '#8a9199',
          red: '#ff5f57',
        },
      },
      boxShadow: {
        glow: '0 0 24px rgba(90, 247, 142, 0.15)',
        'glow-pink': '0 0 28px rgba(255, 106, 193, 0.25)',
        'glow-cyan': '0 0 28px rgba(87, 199, 255, 0.22)',
      },
      animation: {
        blink: 'blink 1s steps(1) infinite',
        'pulse-glow': 'pulseGlow 2.4s ease-in-out infinite',
      },
      keyframes: {
        blink: {
          '0%, 50%': { opacity: '1' },
          '50.01%, 100%': { opacity: '0' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
