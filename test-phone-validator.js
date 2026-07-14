#!/usr/bin/env node
/**
 * test-phone-validator.js
 * ──────────────────────────────────────────────────────
 * Script pour tester les validations WhatsApp par pays
 * Usage: node test-phone-validator.js [option]
 *   - Aucun option: lance tous les tests
 *   - --country CG: teste les numéros du Congo
 *   - --number 065151234 CG: teste un numéro spécifique
 *   - --list: affiche la liste des pays supportés
 */

// Configuration manuelle (puisqu'on utilise require de Node.js)
const AFRICAN_COUNTRIES = {
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
    minLength: 8,
    maxLength: 8,
    placeholder: '9XXXXXXXX',
    hint: '8 chiffres (ex: 94004005)',
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

const VALID_NUMBERS = {
  CG: ['065151234', '06 51 51 234', '+242 65 151 234'],
  BJ: ['94004005', '94 00 40 05', '+229 94 004 005'],
  CI: ['0758123456', '07 58 12 34 56', '+225 7 5812 3456'],
  CM: ['691234567', '69 12 34 567', '+237 6912 34 567'],
  GW: ['6657891', '665 7891', '+245 665 7891'],
  GN: ['628123456', '62 81 23 456', '+224 62 812 3456'],
};

function validatePhoneNumber(phoneNumber, countryCode) {
  const config = AFRICAN_COUNTRIES[countryCode];
  if (!config) {
    return { isValid: false, error: 'Pays non supporté' };
  }

  const cleanNumber = phoneNumber.replace(/\D/g, '');

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

  const formatted = `${config.dialCode}${cleanNumber}`;
  return { isValid: true, formatted };
}

function showCountries() {
  console.log('\n=== PAYS SUPPORTÉS ===\n');
  Object.values(AFRICAN_COUNTRIES).forEach((config) => {
    console.log(`• ${config.name} (${config.code})`);
    console.log(`  ${config.dialCode} | ${config.minLength}-${config.maxLength} chiffres`);
    console.log(`  Exemple: ${config.placeholder}`);
    console.log();
  });
}

function testAllCountries() {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║   TEST: TOUS LES PAYS ET NUMÉROS VALIDES        ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  let totalTests = 0;
  let totalPassed = 0;

  Object.entries(VALID_NUMBERS).forEach(([country, numbers]) => {
    const config = AFRICAN_COUNTRIES[country];
    console.log(`\n${config.name} (${country}):`);

    numbers.forEach((num) => {
      totalTests++;
      const result = validatePhoneNumber(num, country);
      if (result.isValid) {
        console.log(`  ✓ ${num.padEnd(20)} → ${result.formatted}`);
        totalPassed++;
      } else {
        console.log(`  ✗ ${num.padEnd(20)} → ERROR: ${result.error}`);
      }
    });
  });

  console.log(`\n\n✓ Passés: ${totalPassed}/${totalTests}\n`);
}

function testSpecificNumber(number, country) {
  console.log(`\n=== TEST: Numéro spécifique ===\n`);
  
  const config = AFRICAN_COUNTRIES[country];
  if (!config) {
    console.log(`✗ Pays "${country}" non supporté\n`);
    showCountries();
    return;
  }

  console.log(`Pays: ${config.name} (${country})`);
  console.log(`Numéro entré: "${number}"`);
  
  const result = validatePhoneNumber(number, country);
  
  if (result.isValid) {
    console.log(`✓ VALIDE`);
    console.log(`Numéro formaté: ${result.formatted}\n`);
  } else {
    console.log(`✗ INVALIDE: ${result.error}\n`);
    console.log(`Configuration ${config.name}:`);
    console.log(`  Longueur attendue: ${config.minLength}-${config.maxLength} chiffres`);
    console.log(`  Format: ${config.placeholder}\n`);
  }
}

// Main
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--all') {
  testAllCountries();
} else if (args[0] === '--list') {
  showCountries();
} else if (args[0] === '--number' && args[1] && args[2]) {
  testSpecificNumber(args[1], args[2]);
} else if (args[0] === '--country' && args[1]) {
  const country = args[1];
  const config = AFRICAN_COUNTRIES[country];
  if (!config) {
    console.log(`✗ Pays "${country}" non supporté`);
    showCountries();
    return;
  }
  
  console.log(`\n=== TEST: ${config.name} ===\n`);
  const numbers = VALID_NUMBERS[country] || [];
  numbers.forEach((num) => {
    const result = validatePhoneNumber(num, country);
    console.log(`${result.isValid ? '✓' : '✗'} ${num.padEnd(20)} → ${result.formatted || result.error}`);
  });
  console.log();
} else {
  console.log(`
Usage: node test-phone-validator.js [option]

Options:
  --all              Lance tous les tests
  --list             Affiche les pays supportés
  --country XX       Teste les numéros d'un pays (XX = code)
  --number NUM XX    Teste un numéro spécifique

Exemples:
  node test-phone-validator.js --all
  node test-phone-validator.js --list
  node test-phone-validator.js --country CG
  node test-phone-validator.js --number 065151234 CG
  node test-phone-validator.js --number 0758123456 CI
  node test-phone-validator.js --number 628123456 GN
`);
}
