/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#080D1F',
          light: '#111933',
          lighter: '#1A2548',
        },
        neon: {
          pink: '#F25D9C',
          purple: '#7C7EFF',
          blue: '#4FB3FF',
        },
      },
      fontFamily: {
        mono: ['"IBM Plex Mono"', 'monospace'],
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow-pink': '0 0 20px rgba(224, 64, 160, 0.3)',
        'glow-blue': '0 0 20px rgba(64, 96, 255, 0.3)',
        'glow-purple': '0 0 20px rgba(128, 64, 208, 0.3)',
      },
    },
  },
  plugins: [],
};
