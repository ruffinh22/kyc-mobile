/**
 * phoneValidator.ts
 * ──────────────────────────────────────────────────────
 * Validateurs de numéros WhatsApp par pays
 */

export interface CountryConfig {
  code: string;          // Code du pays (ex: 'CG', 'BJ')
  name: string;          // Nom complet
  dialCode: string;      // Indicatif international (ex: '+242')
  minLength: number;     // Longueur minimum des chiffres
  maxLength: number;     // Longueur maximum des chiffres
  placeholder: string;   // Placeholder d'exemple
  hint: string;          // Description
}

export const AFRICAN_COUNTRIES: Record<string, CountryConfig> = {
  CG: {
    code: 'CG',
    name: 'Congo',
    dialCode: '+242',
    minLength: 9,
    maxLength: 9,
    placeholder: '06XXXXXXX',
    hint: '9 chiffres (ex: 065151234)',
  },
  BJ: {
    code: 'BJ',
    name: 'Bénin',
    dialCode: '+229',
    minLength: 10,
    maxLength: 10,
    placeholder: '01XXXXXXXX',
    hint: '10 chiffres (ex: 0123456789)',
  },
  CI: {
    code: 'CI',
    name: 'Côte d\'Ivoire',
    dialCode: '+225',
    minLength: 10,
    maxLength: 10,
    placeholder: '0XXXXXXXXX',
    hint: '10 chiffres (ex: 0758123456)',
  },
  CM: {
    code: 'CM',
    name: 'Cameroun',
    dialCode: '+237',
    minLength: 9,
    maxLength: 9,
    placeholder: '6XXXXXXXX',
    hint: '9 chiffres (ex: 691234567)',
  },
  GW: {
    code: 'GW',
    name: 'Guinée Bissau',
    dialCode: '+245',
    minLength: 7,
    maxLength: 7,
    placeholder: 'XXXXXXX',
    hint: '7 chiffres (ex: 6657891)',
  },
  GN: {
    code: 'GN',
    name: 'Guinée',
    dialCode: '+224',
    minLength: 9,
    maxLength: 9,
    placeholder: '6XXXXXXXX',
    hint: '9 chiffres (ex: 628123456)',
  },
};

/**
 * Valide un numéro selon le pays
 */
export function validatePhoneNumber(
  phoneNumber: string,
  countryCode: string
): { isValid: boolean; error?: string; formatted?: string } {
  const config = AFRICAN_COUNTRIES[countryCode];
  if (!config) {
    return { isValid: false, error: 'Pays non supporté' };
  }

  // Nettoyer le numéro (garder seulement les chiffres)
  const cleanNumber = phoneNumber.replace(/\D/g, '');

  if (countryCode === 'BJ') {
    if (cleanNumber.length !== 10 || !cleanNumber.startsWith('01')) {
      return {
        isValid: false,
        error: 'Le numéro béninois doit contenir 10 chiffres commençant par 01',
      };
    }
  } else {
    if (cleanNumber.length < config.minLength) {
      return {
        isValid: false,
        error: `Au minimum ${config.minLength} chiffres requis`,
      };
    }

    if (cleanNumber.length > config.maxLength) {
      return {
        isValid: false,
        error: `Maximum ${config.maxLength} chiffres acceptés`,
      };
    }
  }

  // Format avec indicatif complet
  const formatted = `${config.dialCode}${cleanNumber}`;

  return { isValid: true, formatted };
}

/**
 * Obtient la configuration d'un pays
 */
export function getCountryConfig(countryCode: string): CountryConfig | null {
  return AFRICAN_COUNTRIES[countryCode] || null;
}

/**
 * Retourne la liste de tous les pays supportés
 */
export function getSupportedCountries(): CountryConfig[] {
  return Object.values(AFRICAN_COUNTRIES);
}
