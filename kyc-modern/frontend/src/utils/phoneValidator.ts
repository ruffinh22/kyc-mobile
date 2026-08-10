export interface CountryConfig {
  code: string;
  name: string;
  dialCode: string;
  minLength: number;
  maxLength: number;
  placeholder: string;
  hint: string;
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
    name: "Côte d'Ivoire",
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
