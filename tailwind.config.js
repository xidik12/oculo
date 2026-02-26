/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{tsx,ts,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        oculo: {
          50: '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63'
        },
        surface: {
          0: '#ffffff',
          1: '#f8f9fa',
          2: '#f1f3f5',
          3: '#e9ecef',
          4: '#dee2e6'
        },
        'surface-dark': {
          0: '#1a1b1e',
          1: '#25262b',
          2: '#2c2e33',
          3: '#373a40',
          4: '#495057'
        },
        sidebar: {
          bg: '#0a0a12',
          hover: '#14141f',
          active: '#1e1e2d',
          border: '#252535'
        },
        'sidebar-light': {
          bg: '#f0f1f4',
          hover: '#e2e4e9',
          active: '#d5d8e0',
          border: '#ccd0d9'
        },
        accent: {
          DEFAULT: '#22d3ee',
          dim: '#0891b2'
        }
      },
      keyframes: {
        'loading-bar': {
          '0%': { transform: 'translateX(-100%)' },
          '50%': { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(100%)' }
        }
      },
      animation: {
        'loading-bar': 'loading-bar 1.5s ease-in-out infinite'
      }
    }
  },
  plugins: []
}
