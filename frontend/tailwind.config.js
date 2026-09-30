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
          DEFAULT: '#FF7A18',
          light: '#FF9A4D',
          dark: '#F9680B',
          // Fond orangé très pâle (badges, survols) — équivalent de --color-primary-pale
          pale: '#FFF0DF',
        },
        health: {
          DEFAULT: '#2EAE5C',
          light: '#E9F9EF',
          dark: '#1E8A45',
        },
        ink: {
          DEFAULT: '#17212B',
          muted: '#66717C',
        },
        soft: '#FFF0DF',
        line: '#ECE8E2',
        star: '#FFB020',
        danger: '#E5484D',
      },
      fontFamily: {
        sans: ['Nunito', 'Poppins', 'system-ui', 'sans-serif'],
        display: ['Poppins', 'Nunito', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '10px',
        md: '16px',
        lg: '22px',
      },
      boxShadow: {
        // v2 : ombre neutre et diffuse (l'ombre orange de la v1 rendait la page
        // « trop orange »). La carte se détache par sa blancheur et son liseré.
        card: '0 10px 35px rgba(20, 30, 40, 0.055), 0 2px 8px rgba(20, 30, 40, 0.035)',
        'card-health': '0 4px 14px rgba(46, 174, 92, 0.12)',
        // Ombre du bouton central surélevé de la bottom nav (§8)
        fab: '0 8px 20px rgba(249, 104, 11, 0.35)',
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
