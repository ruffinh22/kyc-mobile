# 🚀 Quick Start - Test Numéros WhatsApp Multi-Pays

## Tester Immédiatement (sans l'app)

```bash
cd ~/kyc-mobile

# Voir tous les pays
node test-phone-validator.js --list

# Tester tous les numéros
node test-phone-validator.js --all

# Tester un pays spécifique
node test-phone-validator.js --country CG
node test-phone-validator.js --country CI
node test-phone-validator.js --country GN
```

## Numéros à Tester

```bash
# Congo (9 chiffres)
node test-phone-validator.js --number 065151234 CG

# Bénin (8 chiffres)
node test-phone-validator.js --number 94004005 BJ

# Côte d'Ivoire (10 chiffres)
node test-phone-validator.js --number 0758123456 CI

# Cameroun (9 chiffres)
node test-phone-validator.js --number 691234567 CM

# Guinée Bissau (7 chiffres)
node test-phone-validator.js --number 6657891 GW

# Guinée (9 chiffres)
node test-phone-validator.js --number 628123456 GN
```

## Tester dans l'App

```bash
# Démarrer le serveur
npm start

# Lancer Android (dans un autre terminal)
npm run android
```

**Dans l'app:**
1. Sélectionnez un pays en cliquant sur le sélecteur
2. Tapez un numéro (voir les exemples ci-dessus)
3. Vous verrez ✓ quand le numéro est valide
4. Cliquez "Se connecter"

## Résumé des Changements

| Pays | Code | Longueur | Exemple |
|------|------|----------|---------|
| Congo | CG | 9 | 065151234 |
| Bénin | BJ | 8 | 94004005 |
| Côte d'Ivoire | CI | 10 | 0758123456 |
| Cameroun | CM | 9 | 691234567 |
| Guinée Bissau | GW | 7 | 6657891 |
| Guinée | GN | 9 | 628123456 |

## Fichiers Ajoutés/Modifiés

✅ `src/utils/phoneValidator.ts` - Logique de validation
✅ `src/components/CountryPicker.tsx` - Sélecteur UI
✅ `src/screens/LoginScreen.tsx` - Intégration formulaire
✅ `App.tsx` - Stockage/restauration pays
✅ `test-phone-validator.js` - Script test CLI
✅ `MULTIPAYS_WHATSAPP.md` - Documentation complète
