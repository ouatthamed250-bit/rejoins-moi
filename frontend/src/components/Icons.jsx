// Icons.jsx — Jeu d'icônes SVG inline.
//
// Décision : AUCUNE librairie d'icônes ajoutée (ni lucide, ni react-icons).
// Raison : le README fixe la stack (React + Vite + Tailwind) et l'app vise des
// smartphones d'entrée de gamme en 3G — quelques kilo-octets de SVG maison valent
// mieux qu'une dépendance de plus. Toutes les icônes partagent la même grille
// 24×24, le même trait de 1,8 et héritent de `currentColor` : elles se colorent
// donc automatiquement en orange (feed) ou en vert (santé, §6).

const TRACES = {
  // ── Navigation / structure ──
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20a1 1 0 0 0 1 1H10v-5.5h4V21h3.5a1 1 0 0 0 1-1V9.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  message: (
    <path d="M21 12a7.5 7.5 0 0 1-7.5 7.5H8.2L4 22v-4.4A7.5 7.5 0 0 1 4.5 12 7.5 7.5 0 0 1 12 4.5h1.5A7.5 7.5 0 0 1 21 12Z" />
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </>
  ),
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  check: <path d="m5 13 4.5 4.5L19 7" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  bell: (
    <>
      <path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2.5h-15L6 16Z" />
      <path d="M10 21h4" />
    </>
  ),

  // ── Compteurs (§3 : les deux compteurs ne sont JAMAIS fusionnés) ──
  eye: (
    <>
      <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3 19.5a6 6 0 0 1 12 0" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6" />
      <path d="M17.5 14.2A5.5 5.5 0 0 1 21 19.5" />
    </>
  ),
  star: <path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8L12 4Z" />,
  verified: (
    <>
      <path d="m12 3 2.2 1.6 2.7-.2 1 2.5 2.4 1.3-.7 2.6.7 2.6-2.4 1.3-1 2.5-2.7-.2L12 21l-2.2-1.6-2.7.2-1-2.5L3.7 15.8l.7-2.6-.7-2.6L6.1 9.3l1-2.5 2.7.2L12 3Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),

  // ── Géolocalisation / contact ──
  mapPin: (
    <>
      <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  route: (
    <>
      <path d="M6.5 3.5 3.5 6.5l3 3" />
      <path d="M3.5 6.5H16a5 5 0 0 1 0 10H8" />
      <path d="m10.5 20.5-3-3 3-3" />
    </>
  ),
  phone: (
    <path d="M6.2 3.5h2.6l1.5 3.8-1.9 1.3a11.5 11.5 0 0 0 5.9 5.9l1.3-1.9 3.8 1.5v2.6c0 1.3-1.1 2.3-2.4 2.1C9.4 17.6 5.9 14.1 4.1 5.9 3.9 4.6 4.9 3.5 6.2 3.5Z" />
  ),
  whatsapp: (
    <>
      <path d="M20 11.7A8 8 0 0 1 8.4 19L4 20l1.1-4.3A8 8 0 1 1 20 11.7Z" />
      <path d="M9 9.2c0 3 2.4 5.4 5.4 5.4" />
      <path d="M9 9.2h1.4l.7 1.6-1 .7c.4 1 1.2 1.8 2.2 2.2l.7-1 1.6.7V15" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.6V12l3 1.8" />
    </>
  ),
  share: (
    <>
      <path d="M12 15V4" />
      <path d="m8.5 7.5 3.5-3.5 3.5 3.5" />
      <path d="M5.5 13v6a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-6" />
    </>
  ),

  // ── Santé (§6 : icônes distinctes pharmacie / clinique) ──
  pharmacy: (
    <>
      <path d="M4 9.5h16l-1.4 9.2a1.5 1.5 0 0 1-1.5 1.3H6.9a1.5 1.5 0 0 1-1.5-1.3L4 9.5Z" />
      <path d="M3 9.5 5 4.5h4l1 5" />
      <path d="M15 4.5h4l1.4 5" />
      <path d="M12 11.5v5.5" />
      <path d="M9.3 14.2h5.4" />
    </>
  ),
  hospital: (
    <>
      <path d="M5 21V6.5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1V21" />
      <path d="M4 21h16" />
      <path d="M12 8.5v6" />
      <path d="M9 11.5h6" />
    </>
  ),

  // ── Catégories du feed (§4) ──
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </>
  ),
  utensils: (
    <>
      <path d="M7 3.5v8a2.5 2.5 0 0 1-5 0v-8" />
      <path d="M4.5 11.5V21" />
      <path d="M15 3.5c2.6 0 4 1.8 4 4.5s-1.4 4-4 4" />
      <path d="M15 12V21" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <path d="M8.7 8 20 18" />
      <path d="M8.7 16 20 6" />
    </>
  ),
  tools: (
    <>
      <path d="m14.5 6.5 3-3a3.5 3.5 0 0 1 0 5l-3 3" />
      <path d="M11.5 12.5 4 20l1.5 1.5 7.5-7.5" />
      <path d="m9 5.5 4 4-2 2-4-4" />
    </>
  ),
  hammer: (
    <>
      <path d="m14 3 7 7-2.5 2.5-7-7z" />
      <path d="M11.5 8.5 4 16l2.5 2.5 7.5-7.5" />
    </>
  ),
  store: (
    <>
      <path d="M4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9" />
      <path d="M3.5 7 5 4h14l1.5 3 1 3H2.5l1-3Z" />
      <path d="M9.5 20v-5h5v5" />
    </>
  ),
  heart: (
    <path d="M12 20s-7.5-4.6-7.5-9.6A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 7.5 3C19.5 15.4 12 20 12 20Z" />
  ),
  church: (
    <>
      <path d="M12 3v6" />
      <path d="M9.5 6h5" />
      <path d="M6 21v-7.5L12 9l6 4.5V21" />
      <path d="M4.5 21h15" />
      <path d="M10.5 21v-4h3v4" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="3.2" />,

  // ── Main-d'œuvre / paiement ──
  briefcase: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
      <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
      <path d="M3.5 12.5h17" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <circle cx="17" cy="14.5" r="1.2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5h3l1.5-2h7L17 8.5h3a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13.5" r="3.2" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m5 17 4.5-4.5 4 4L16 14l3 3" />
    </>
  ),
  // Ajout du 29/09 (PWA) : icône d'installation « télécharger / poser le raccourci »
  download: (
    <>
      <path d="M12 3.5v10.5" />
      <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
      <path d="M4.5 17.2v2A1.3 1.3 0 0 0 5.8 20.5h12.4a1.3 1.3 0 0 0 1.3-1.3v-2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.5 21 19.5H3L12 4.5Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="16.8" r="0.8" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8.2" r="0.8" />
    </>
  ),
  loader: (
    <>
      <path d="M12 3.5v3.2" />
      <path d="M12 17.3v3.2" />
      <path d="M3.5 12h3.2" />
      <path d="M17.3 12h3.2" />
      <path d="m6.4 6.4 2.3 2.3" />
      <path d="m15.3 15.3 2.3 2.3" />
      <path d="m17.6 6.4-2.3 2.3" />
      <path d="m8.7 15.3-2.3 2.3" />
    </>
  ),
  wifiOff: (
    <>
      <path d="M4 9a13 13 0 0 1 5-2.6" />
      <path d="M20 9a13 13 0 0 0-4-2.2" />
      <path d="M7 12.5a8 8 0 0 1 3-1.4" />
      <path d="M17 12.5a8 8 0 0 0-2.4-1.3" />
      <circle cx="12" cy="17" r="1" />
      <path d="M3.5 3.5l17 17" />
    </>
  ),
};

/**
 * Icône SVG décorative (toujours `aria-hidden`) : le sens est porté par le texte
 * qui l'accompagne. Les icônes de compteurs (§3) sont TOUJOURS utilisées par paire
 * — œil pour les visites, personnes pour les utilisateurs.
 *
 * @param {{ name: string, size?: number, filled?: boolean, className?: string, strokeWidth?: number }} props
 */
export function Icon({ name, size = 22, filled = false, className = '', strokeWidth = 1.8, ...rest }) {
  const trace = TRACES[name] || TRACES.dot;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {trace}
    </svg>
  );
}

/** Icône tournante pour les états de chargement (`animate-spin` fourni par Tailwind). */
export function IconLoader({ size = 22, className = '' }) {
  return <Icon name="loader" size={size} className={`animate-spin ${className}`} />;
}

export default Icon;
