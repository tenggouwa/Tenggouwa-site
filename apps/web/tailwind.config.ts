import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

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
      typography: () => ({
        // 主体 prose 颜色用终端配色；prose-invert 自动拾取这些 var
        DEFAULT: {
          css: {
            '--tw-prose-body': '#c5cbd3',
            '--tw-prose-headings': '#5af78e',
            '--tw-prose-lead': '#a3acb5',
            '--tw-prose-links': '#57c7ff',
            '--tw-prose-bold': '#e5e9ed',
            '--tw-prose-counters': '#8a9199',
            '--tw-prose-bullets': '#3a8059',
            '--tw-prose-hr': '#1f2a30',
            '--tw-prose-quotes': '#c5cbd3',
            '--tw-prose-quote-borders': '#5af78e',
            '--tw-prose-captions': '#8a9199',
            '--tw-prose-code': '#ff6ac1',
            '--tw-prose-pre-code': '#d4dadf',
            '--tw-prose-pre-bg': '#0d1418',
            '--tw-prose-th-borders': '#1f2a30',
            '--tw-prose-td-borders': '#1f2a30',
            maxWidth: 'none',
            // 关键：图片自适应容器宽度
            img: {
              maxWidth: '100%',
              height: 'auto',
              borderRadius: '0.5rem',
              border: '1px solid #1f2a30',
              marginTop: '1.2em',
              marginBottom: '1.2em',
            },
            // 代码块横向滚动而不撑破布局
            pre: {
              overflowX: 'auto',
              border: '1px solid #1f2a30',
              borderRadius: '0.5rem',
              fontSize: '0.875em',
            },
            // 行内 code 加点边框，免得贴文字
            ':not(pre) > code': {
              backgroundColor: '#11181c',
              padding: '0.15em 0.4em',
              borderRadius: '0.3em',
              border: '1px solid #1f2a30',
              fontWeight: '500',
            },
            // 去掉行内 code 默认的 `` 装饰
            ':not(pre) > code::before': { content: '""' },
            ':not(pre) > code::after': { content: '""' },
            // 链接更明显
            a: {
              textDecoration: 'underline',
              textDecorationColor: '#1f4a3a',
              textUnderlineOffset: '3px',
              transition: 'color 0.15s, text-decoration-color 0.15s',
            },
            'a:hover': {
              color: '#5af78e',
              textDecorationColor: '#5af78e',
            },
            // 引用块
            blockquote: {
              fontStyle: 'normal',
              borderLeftWidth: '3px',
              paddingLeft: '1em',
              opacity: 0.9,
            },
            // 标题前缀像 shell prompt
            'h1, h2, h3, h4': {
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '-0.01em',
            },
            'h2::before': {
              content: '"## "',
              color: '#ff6ac1',
            },
            'h3::before': {
              content: '"### "',
              color: '#ff6ac1',
            },
            'h4::before': {
              content: '"#### "',
              color: '#ff6ac1',
            },
            // 表格细化
            table: { fontSize: '0.9em' },
            thead: { borderBottomColor: '#5af78e' },
            'thead th': { color: '#5af78e' },
          },
        },
      }),
    },
  },
  plugins: [typography],
};

export default config;
