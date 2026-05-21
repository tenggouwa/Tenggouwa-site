import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  // Arco 自带 reset，Tailwind 的 preflight 会跟它打架，直接关掉。
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      fontFamily: {
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'SF Mono',
          'Menlo',
          'Consolas',
          'monospace',
        ],
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
        },
      },
      boxShadow: {
        glow: '0 0 24px rgba(90, 247, 142, 0.15)',
      },
      animation: {
        blink: 'blink 1s steps(1) infinite',
        'noise-pan': 'noisePan 8s linear infinite',
      },
      keyframes: {
        blink: {
          '0%, 50%': { opacity: '1' },
          '50.01%, 100%': { opacity: '0' },
        },
        noisePan: {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '200px 200px' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
