// ============================================================================
// KYC Mobile — Design Tokens (alignés sur kyc-modern web V4)
// Charte MTN : Jaune #FFCC00 · Bleu marine #003087 · Inter
// ============================================================================
// Auto-export pour forcer réanalyse TypeScript

export const C = {
  // MTN Yellow
  yellow:       '#FFCC00',
  yellowH:      '#E6B800',
  yellowSoft:   'rgba(255,204,0,0.14)',
  yellowBorder: 'rgba(255,204,0,0.28)',

  // MTN Blue
  blue:         '#003087',
  blueMid:      '#0057A8',
  blueLight:    'rgba(0,48,135,0.10)',
  blueBorder:   'rgba(0,48,135,0.24)',

  // Backgrounds (premium light fintech)
  bg0:          '#F5F7FB',   // fond principal
  bg1:          '#FFFFFF',   // cartes
  bg2:          'rgba(0,48,135,0.06)',  // champs
  bgBorder:     'rgba(15,23,42,0.10)',

  // Ink
  ink:          '#0F172A',   // texte principal
  ink2:         '#334155',   // secondaire
  ink3:         '#64748B',   // tertiaire

  // Status
  success:      '#0F8A5F',
  successSoft:  'rgba(15,138,95,0.12)',
  successBorder:'rgba(15,138,95,0.24)',
  successText:  '#0B6A49',

  danger:       '#D92D20',
  dangerSoft:   'rgba(217,45,32,0.12)',
  dangerBorder: 'rgba(217,45,32,0.24)',
  dangerText:   '#B42318',

  warn:         '#D97706',

  // Shadows
  shadowBlue:   '#003087',
  shadowYellow: '#FFCC00',
} as const;

export const R = {
  xs:   6,
  sm:   10,
  md:   14,
  lg:   18,
  xl:   24,
  pill: 999,
} as const;

export const T = {
  // Tailles typographiques
  xs:   11,
  sm:   12,
  base: 14,
  md:   16,
  lg:   18,
  xl:   22,
  '2xl': 28,
  '3xl': 34,
} as const;
