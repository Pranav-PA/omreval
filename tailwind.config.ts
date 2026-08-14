import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f172a',
        muted: '#64748b',
        line: '#e2e8f0',
        brand: {
          DEFAULT: '#1d4ed8',
          dark: '#1e40af',
          light: '#eff6ff',
        },
        ok: '#15803d',
        bad: '#b91c1c',
        warn: '#b45309',
      },
    },
  },
  plugins: [],
};

export default config;
