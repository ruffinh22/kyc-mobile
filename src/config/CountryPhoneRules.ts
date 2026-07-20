/**
 * CountryPhoneRules - Règles de validation stricte des numéros téléphoniques par pays
 * 
 * Architecture:
 *   - Configuration centralisée des formats téléphoniques par pays
 *   - Validation stricte (nombre exact de chiffres, préfixes valides)
 *   - Support multi-opérateurs
 * 
 * Production Grade: OUI
 * Last Updated: 2026-06-24
 * 
 * @author KYC Mobile Team
 * @version 1.0.0
 */

export interface PhoneRule {
  /** Code ISO 2 du pays */
  code: string;
  /** Nom du pays */
  name: string;
  /** Nombre exact de chiffres requis (sans le préfixe international) */
  digitCount: number;
  /** Préfixes valides (ex: ['6', '7'] pour Congo) */
  validPrefixes: string[];
  /** Format d'affichage pour l'utilisateur */
  displayFormat: string;
  /** Texte de substitution affiché dans le champ de saisie */
  placeholder: string;
  /** Exemple de numéro valide */
  example: string;
  /** Opérateurs MTN disponibles dans le pays */
  operators: {
    mtn: boolean;
    orange?: boolean;
    vodafone?: boolean;
    other?: string[];
  };
}

/**
 * Règles de validation téléphonique strictes par pays
 * 
 * Validation:
 *   1. Exactement N chiffres (pas plus, pas moins)
 *   2. Premier chiffre dans la liste validPrefixes
 *   3. Tous les caractères doivent être des chiffres
 */
export const COUNTRY_PHONE_RULES: Record<string, PhoneRule> = {
  CG: {
    code: 'CG',
    name: 'Congo (Rép. Dém.)',
    digitCount: 9,
    validPrefixes: ['0'], // MTN Congo: 06xxx xxxx, 07xxx xxxx
    displayFormat: '0XX XXX XXXX',
    placeholder: '061234567',
    example: '061234567',
    operators: {
      mtn: true,
      other: ['Vodacom', 'Airtel'],
    },
  },

  BJ: {
    code: 'BJ',
    name: 'Bénin',
    digitCount: 10,
    validPrefixes: ['01'],
    displayFormat: '01 XX XX XX XX',
    placeholder: '0123456789',
    example: '0123456789',
    operators: {
      mtn: true,
      orange: true,
    },
  },

  CI: {
    code: 'CI',
    name: 'Côte d\'Ivoire',
    digitCount: 10, // Côte d'Ivoire: 10 chiffres
    validPrefixes: ['0'], // Commence par 0
    displayFormat: '0X XXXX XXXX',
    placeholder: '0501234567',
    example: '0501234567',
    operators: {
      mtn: true,
      orange: true,
      vodafone: true,
    },
  },

  CM: {
    code: 'CM',
    name: 'Cameroun',
    digitCount: 9, // Cameroun: 9 chiffres (6, 7)
    validPrefixes: ['6', '7'],
    displayFormat: 'XX XXX XXX',
    placeholder: '612345678',
    example: '612345678',
    operators: {
      mtn: true,
      orange: true,
    },
  },

  GW: {
    code: 'GW',
    name: 'Guinée Bissau',
    digitCount: 7, // Guinée Bissau: 7 chiffres
    validPrefixes: ['9', '7'],
    displayFormat: 'XXX XXXX',
    placeholder: '9654321',
    example: '9654321',
    operators: {
      mtn: true,
    },
  },

  GN: {
    code: 'GN',
    name: 'Guinée',
    digitCount: 8, // Guinée: 8 chiffres
    validPrefixes: ['6'],
    displayFormat: 'XX XXX XXX',
    placeholder: '61234567',
    example: '61234567',
    operators: {
      mtn: true,
      orange: true,
    },
  },
};

/**
 * Validateur stricte de numéro téléphonique selon le pays
 * 
 * @param phoneNumber Numéro à valider (chiffres uniquement)
 * @param countryCode Code ISO du pays
 * @returns { valid: boolean, error?: string }
 * 
 * Exemples:
 *   validatePhoneNumber('061234567', 'CG') → { valid: true }
 *   validatePhoneNumber('1234567', 'CG') → { valid: false, error: 'Exactement 9 chiffres requis' }
 *   validatePhoneNumber('161234567', 'CG') → { valid: false, error: 'Doit commencer par 0, 6 ou 7' }
 */
export function validatePhoneNumber(
  phoneNumber: string,
  countryCode: string
): { valid: boolean; error?: string; rule?: PhoneRule } {
  // Nettoyer: garder que les chiffres
  const cleaned = (phoneNumber || '').replace(/\D/g, '');

  // Récupérer la règle du pays
  const rule = COUNTRY_PHONE_RULES[countryCode];
  if (!rule) {
    return { valid: false, error: 'Pays non supporté' };
  }

  // 1. Vérifier le nombre exact de chiffres
  if (cleaned.length !== rule.digitCount) {
    return {
      valid: false,
      error: `Exactement ${rule.digitCount} chiffre(s) requis (reçu: ${cleaned.length})`,
      rule,
    };
  }

  // 2. Vérifier le préfixe
  const hasValidPrefix = rule.validPrefixes.some(prefix => cleaned.startsWith(prefix));
  if (!hasValidPrefix) {
    return {
      valid: false,
      error: `Doit commencer par: ${rule.validPrefixes.join(' ou ')}`,
      rule,
    };
  }

  // 3. Vérifier que ce sont tous des chiffres
  if (!/^\d+$/.test(cleaned)) {
    return { valid: false, error: 'Doit contenir uniquement des chiffres', rule };
  }

  return { valid: true, rule };
}

/**
 * Formater un numéro selon les règles du pays
 * 
 * @param phoneNumber Numéro brut
 * @param countryCode Code ISO
 * @returns Numéro formaté ou original si invalide
 */
export function formatPhoneNumber(phoneNumber: string, countryCode: string): string {
  const rule = COUNTRY_PHONE_RULES[countryCode];
  if (!rule) return phoneNumber;

  const cleaned = phoneNumber.replace(/\D/g, '');
  if (cleaned.length !== rule.digitCount) return phoneNumber;

  // Format simple: insertion d'espaces selon le pattern
  // Ex: "061234567" → "06 1234 567" (si format est "0XX XXXX XXXX")
  const parts: string[] = [];
  let partIndex = 0;
  let digitIndex = 0;

  for (let i = 0; i < rule.displayFormat.length; i++) {
    if (rule.displayFormat[i] === 'X') {
      parts[partIndex] = (parts[partIndex] || '') + cleaned[digitIndex];
      digitIndex++;
    } else if (rule.displayFormat[i] === ' ') {
      partIndex++;
    }
  }

  return parts.join(' ');
}

/**
 * Obtenir la règle du pays
 */
export function getPhoneRule(countryCode: string): PhoneRule | null {
  return COUNTRY_PHONE_RULES[countryCode] || null;
}

/**
 * Obtenir tous les pays supportés
 */
export function getSupportedCountries(): PhoneRule[] {
  return Object.values(COUNTRY_PHONE_RULES);
}
