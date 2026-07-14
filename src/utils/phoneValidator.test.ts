/**
 * phoneValidator.test.ts
 * ──────────────────────────────────────────────────────
 * Tests pour les numéros WhatsApp par pays
 * 
 * Usage: npx jest phoneValidator.test.ts
 * Ou vérifiez manuellement en utilisant Python ou Node.js:
 *   node -e "require('./src/utils/phoneValidator').validatePhoneNumber('065151234', 'CG')"
 */

import {
  validatePhoneNumber,
  getCountryConfig,
  getSupportedCountries,
  AFRICAN_COUNTRIES,
} from './phoneValidator';

// ── Numéros de test valides par pays ──────────────────────────────────────
export const VALID_TEST_NUMBERS = {
  CG: ['065151234', '06 51 51 234', '+242 65 151 234'], // Congo
  BJ: ['0123456789', '01 23 45 67 89', '+229 01 23 45 67 89'], // Bénin
  CI: ['0758123456', '07 58 12 34 56', '+225 7 5812 3456'], // Côte d'Ivoire
  CM: ['691234567', '69 12 34 567', '+237 6912 34 567'],  // Cameroun
  GW: ['6657891', '665 7891', '+245 665 7891'],          // Guinée Bissau
  GN: ['628123456', '62 81 23 456', '+224 62 812 3456'], // Guinée
};

// ── Numéros de test invalides ──────────────────────────────────────────────
export const INVALID_TEST_NUMBERS = {
  CG: ['123', '1234567890'], // Congo: trop court ou trop long
  BJ: ['123', '12345678901', '0012345678'],  // Bénin: trop court, trop long ou mauvais préfixe
  CI: ['123', '12345'],      // Côte d'Ivoire: trop court
  CM: ['12', '1234567890'],  // Cameroun: trop court ou trop long
  GW: ['12', '12345678'],    // Guinée Bissau: trop court ou trop long
  GN: ['123', '1234567890'], // Guinée: trop court ou trop long
};

/**
 * Vérifie que tous les numéros valides sont acceptés
 */
export function testValidNumbers() {
  console.log('=== TEST: Numéros valides ===\n');
  
  let passCount = 0;
  let failCount = 0;

  Object.entries(VALID_TEST_NUMBERS).forEach(([country, numbers]) => {
    const config = AFRICAN_COUNTRIES[country];
    console.log(`\n${config.name} (${country}):`);

    numbers.forEach((num) => {
      const result = validatePhoneNumber(num, country);
      const passed = result.isValid;
      
      if (passed) {
        console.log(`  ✓ ${num} → ${result.formatted}`);
        passCount++;
      } else {
        console.log(`  ✗ ${num} → ERREUR: ${result.error}`);
        failCount++;
      }
    });
  });

  console.log(`\n\n✓ Passés: ${passCount} | ✗ Échoués: ${failCount}\n`);
  return failCount === 0;
}

/**
 * Vérifie que tous les numéros invalides sont rejetés
 */
export function testInvalidNumbers() {
  console.log('=== TEST: Numéros invalides (doivent être rejetés) ===\n');
  
  let passCount = 0;
  let failCount = 0;

  Object.entries(INVALID_TEST_NUMBERS).forEach(([country, numbers]) => {
    const config = AFRICAN_COUNTRIES[country];
    console.log(`\n${config.name} (${country}):`);

    numbers.forEach((num) => {
      const result = validatePhoneNumber(num, country);
      const rejected = !result.isValid;
      
      if (rejected) {
        console.log(`  ✓ ${num} rejeté (${result.error})`);
        passCount++;
      } else {
        console.log(`  ✗ ${num} accepté à tort → ${result.formatted}`);
        failCount++;
      }
    });
  });

  console.log(`\n\n✓ Passés: ${passCount} | ✗ Échoués: ${failCount}\n`);
  return failCount === 0;
}

/**
 * Affiche la configuration de chaque pays
 */
export function showCountryConfigs() {
  console.log('=== CONFIGURATION DES PAYS ===\n');
  
  getSupportedCountries().forEach((config) => {
    console.log(`${config.name}:`);
    console.log(`  Code: ${config.code}`);
    console.log(`  Indicatif: ${config.dialCode}`);
    console.log(`  Longueur: ${config.minLength}-${config.maxLength} chiffres`);
    console.log(`  Format: ${config.placeholder}`);
    console.log(`  Info: ${config.hint}`);
    console.log();
  });
}

/**
 * Lance tous les tests
 */
export function runAllTests() {
  console.log('\n╔═════════════════════════════════════════════════╗');
  console.log('║   TESTS DE VALIDATION WHATSAPP PAR PAYS          ║');
  console.log('╚═════════════════════════════════════════════════╝\n');

  showCountryConfigs();
  const validPassed = testValidNumbers();
  const invalidPassed = testInvalidNumbers();

  const allPassed = validPassed && invalidPassed;
  console.log(allPassed 
    ? '✓✓✓ TOUS LES TESTS SONT PASSÉS\n'
    : '✗✗✗ CERTAINS TESTS ONT ÉCHOUÉ\n'
  );

  return allPassed;
}

// Exporter pour Jest si utilisé
export const tests = {
  testValidNumbers,
  testInvalidNumbers,
  showCountryConfigs,
  runAllTests,
};
