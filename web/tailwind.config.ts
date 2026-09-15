import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#17191c',
        paper: '#ffffff',
        mist: '#f2f2f3',
        fog: '#fafafb',
        slate: '#777b86',
        ash: '#979799',
        smoke: '#a3a6af',
        peach: '#fbe1d1',
        sienna: '#5d2a1a',
      },
      fontFamily: {
        serif: ['Georgia', 'ui-serif', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '24px',
        image: '12px',
        input: '16px',
        pill: '9999px',
        small: '16px',
        elevated: '20px',
      },
      boxShadow: {
        subtle: '0 0 0 1px rgba(4,23,43,0.05), 0 4px 24px 0 rgba(0,0,0,0.08)',
        float: '0 0 0 1px rgba(4,23,43,0.05), 0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
      },
    },
  },
  plugins: [],
};

export default config;