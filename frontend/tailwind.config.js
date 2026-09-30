/** @type {import('tailwindcss').Config} */
// Les couleurs ci-dessous reprennent EXACTEMENT les valeurs des variables CSS de
// src/styles/theme.css (source de vérité du design). Toute modification de la
// palette doit être faite dans les deux fichiers pour rester cohérente.
//
// Rappel produit : la section Pharmacies & Cliniques utilise la palette `health`
// (vert) et ne doit JAMAIS utiliser `primary` (orange) — voir §6 du cahier des charges.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#FF7A2E',
          light: '#FFA366',
          dark: '#E85D0A',
        },
        health: {
          DEFAULT: '#2EAE5C',
          light: '#E9F9EF',
          dark: '#1E8A45',
        },
        ink: {
          DEFAULT: '#1A1A1A',
          muted: '#6B6B6B',
        },
        soft: '#FFF6EE',
        line: '#F0E4D8',
        star: '#FFB020',
        danger: '#E5484D',
      },
      fontFamily: {
        sans: ['Nunito', 'Poppins', 'system-ui', 'sans-serif'],
        display: ['Poppins', 'Nunito', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '8px',
        md: '14px',
        lg: '22px',
      },
      boxShadow: {
        card: '0 4px 14px rgba(255, 122, 46, 0.12)',
        'card-health': '0 4px 14px rgba(46, 174, 92, 0.12)',
        // Ombre du bouton central surélevé de la bottom nav (§8)
        fab: '0 8px 20px rgba(232, 93, 10, 0.35)',
      },
      keyframes: {
        // Transitions "captives" mais discrètes (§8) : les cartes montent en fondu,
        // ce qui donne une impression de fil qui se remplit au fur et à mesure.
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        popIn: {
          '0%': { opacity: '0', transform: 'scale(0.94)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.06)' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 400ms ease both',
        'pop-in': 'popIn 220ms ease both',
        breathe: 'breathe 2.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
