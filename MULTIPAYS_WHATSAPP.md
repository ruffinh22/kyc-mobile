# Support Multi-Pays WhatsApp

Ce document explique comment tester l'application avec des numéros WhatsApp de plusieurs pays africains.

## Pays Supportés

L'application supporte maintenant les numéros WhatsApp des pays suivants:

| Pays | Code | Indicatif | Longueur | Format Exemple |
|------|------|-----------|----------|---|
| **Congo** | CG | +242 | 9 chiffres | 065151234 |
| **Bénin** | BJ | +229 | 8 chiffres | 94004005 |
| **Côte d'Ivoire** | CI | +225 | 10 chiffres | 0758123456 |
| **Cameroun** | CM | +237 | 9 chiffres | 691234567 |
| **Guinée Bissau** | GW | +245 | 7 chiffres | 6657891 |
| **Guinée** | GN | +224 | 9 chiffres | 628123456 |

## Tester via l'Application

### 1. Lancer l'application

```bash
cd /home/lidruf/kyc-mobile
npm install
npm start
```

Ensuite, lancez Android:
```bash
npm run android
```

### 2. Utiliser l'écran de connexion

1. **Sélectionner un pays** : Tapez sur le sélecteur "PAYS" en haut du formulaire
2. **Entrer le numéro** : Tapez le numéro sans l'indicatif international
   - Pour Congo: `065151234`
   - Pour Bénin: `94004005`
   - Pour Côte d'Ivoire: `0758123456`
   - etc.
3. **Validation en temps réel** : Vous verrez ✓ lorsque le numéro est valide
4. **Se connecter** : Tapez "Se connecter"

## Tester via le Script CLI

Un script de test est disponible pour valider rapidement les numéros:

### Tester tous les numéros valides

```bash
cd /home/lidruf/kyc-mobile
node test-phone-validator.js --all
```

### Voir les pays supportés

```bash
node test-phone-validator.js --list
```

### Tester un pays spécifique

```bash
node test-phone-validator.js --country CG
node test-phone-validator.js --country BJ
node test-phone-validator.js --country CI
```

### Tester un numéro spécifique

```bash
node test-phone-validator.js --number 065151234 CG
node test-phone-validator.js --number 0758123456 CI
node test-phone-validator.js --number 628123456 GN
```

## Numéros de Test Valides

Voici des numéros que vous pouvez utiliser pour tester:

### Congo (CG)
```
065151234
067123456
069999999
```

### Bénin (BJ)
```
94004005
96000001
98888888
```

### Côte d'Ivoire (CI)
```
0758123456
0707654321
0777777777
```

### Cameroun (CM)
```
691234567
675555555
699999999
```

### Guinée Bissau (GW)
```
6657891
6651234
6659999
```

### Guinée (GN)
```
628123456
621111111
629999999
```

## Architecture de la Solution

### Fichiers Modifiés/Créés

1. **`src/utils/phoneValidator.ts`** - Utilitaire de validation
   - Règles de validation par pays
   - Fonction `validatePhoneNumber()`
   - Configuration `AFRICAN_COUNTRIES`

2. **`src/components/CountryPicker.tsx`** - Composant sélecteur de pays
   - Sélection par modal
   - Affichage du pays et de l'indicatif

3. **`src/screens/LoginScreen.tsx`** - Écran modifié
   - Intégration du sélecteur de pays
   - Validation multi-pays
   - Sauvegarde du pays sélectionné

4. **`App.tsx`** - Restauration de session
   - Récupère le pays sauvegardé

5. **`test-phone-validator.js`** - Script de test CLI
   - Tests rapides sans démarrer l'app

6. **`src/utils/phoneValidator.test.ts`** - Tests unitaires
   - Numéros valides/invalides par pays
   - Pour Jest ou tests manuels

## Flux de Validation

```
Utilisateur saisit un numéro
           ↓
Suppression des caractères non-numériques
           ↓
Récupération de la config du pays
           ↓
Vérification de la longueur (min/max)
           ↓
Validation réussie?
    ↙ Oui           ↘ Non
Bouton actif      Message erreur
```

## Stockage Local

Quand l'utilisateur se connecte, l'application sauvegarde:
- `kyc_numero` - Le numéro (sans indicatif)
- `kyc_server` - L'URL du serveur
- `kyc_country` - Le code du pays (ex: 'CG')

## Notes

- Les numéros sont stockés **sans** l'indicatif international (+242, +229, etc.)
- Lors de l'appel WebRTC, le numéro complet est formé: `+[CODE][NUMERO]`
- Les espaces et tirets sont automatiquement ignorés
- La validation est en temps réel (feedback immédiat)
- Les hints s'adaptent selon le pays sélectionné

## Dépannage

### "Pays non supporté"
→ Vérifiez que vous avez sélectionné l'un des 6 pays disponibles

### "Au minimum X chiffres requis"
→ Vous avez entré trop peu de chiffres. Consultez le hint sous le champ.

### "Maximum X chiffres acceptés"
→ Vous avez entré trop de chiffres. Consultez le hint sous le champ.

### Le numéro n'est pas reconnu par WhatsApp
→ Assurez-vous que le numéro WhatsApp existe réellement dans le pays

## Étapes Futures

- [ ] Détection automatique du pays basée sur le numéro
- [ ] Import de contacts WhatsApp
- [ ] Cache des pays dernièrement utilisés
- [ ] Historique des connexions
- [ ] Préfixes régionaux optionnels (ex: Kinshasa pour Congo)
