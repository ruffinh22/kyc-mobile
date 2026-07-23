#!/bin/bash
# build-and-install.sh
# Compile et installe l'APK release sur le téléphone
# Usage: ./build-and-install.sh [--logs] [--clear]

set -e

PROJECT_DIR="/home/lidruf/kyc-mobile"
APK_PATH="$PROJECT_DIR/android/app/build/outputs/apk/release/app-release.apk"
PACKAGE_NAME="com.kycmobile"
ACTIVITY_NAME=".MainActivity"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

show_header() {
  echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║  $1${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
}

show_step() {
  echo -e "\n${YELLOW}→ $1${NC}"
}

show_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

show_error() {
  echo -e "${RED}✗ $1${NC}"
}

# Vérifier les options
SHOW_LOGS=false
CLEAR_DATA=false

set -o pipefail

for arg in "$@"; do
  case $arg in
    --logs)
      SHOW_LOGS=true
      ;;
    --clear)
      CLEAR_DATA=true
      ;;
  esac
done

show_header "KYC Mobile - Build & Install APK Release"

# Étape 1: Vérifier le téléphone
show_step "Vérification du téléphone"
if ! adb devices | grep -q "device$"; then
  show_error "Aucun téléphone connecté!"
  echo "Connectez un téléphone et activez le débogage USB."
  exit 1
fi
show_success "Téléphone détecté"

# Étape 2: Compiler
show_step "Compilation de l'APK release"
cd "$PROJECT_DIR"
LOG_FILE="/tmp/kyc-android-build.log"
if ! npm run build:android >"$LOG_FILE" 2>&1; then
  tail -80 "$LOG_FILE"
  show_error "Échec de la compilation Android"
  exit 1
fi

tail -40 "$LOG_FILE"
show_success "Compilation réussie"

# Étape 3: Vérifier que l'APK existe
if [ ! -f "$APK_PATH" ]; then
  show_error "APK introuvable: $APK_PATH"
  exit 1
fi

APK_SIZE=$(du -h "$APK_PATH" | cut -f1)
show_success "APK généré: $APK_SIZE"

# Étape 4: Effacer les données (optionnel)
if [ "$CLEAR_DATA" = true ]; then
  show_step "Effacement des données de l'app"
  adb shell pm clear "$PACKAGE_NAME"
  show_success "Données effacées"
fi

# Étape 5: Installer l'APK
show_step "Installation de l'APK sur le téléphone"
adb install -r "$APK_PATH"
show_success "APK installée"

# Étape 6: Lancer l'app (optionnel)
show_step "Lancement de l'app"
adb shell am start -n "$PACKAGE_NAME/$ACTIVITY_NAME"
show_success "App lancée"

# Étape 7: Afficher les logs (optionnel)
if [ "$SHOW_LOGS" = true ]; then
  show_step "Affichage des logs (Ctrl+C pour arrêter)"
  sleep 2
  adb logcat | grep -E "KYC|SignalingService|NotificationService|health|WebSocket"
fi

echo ""
show_success "✓ Installation complète!"
echo ""
echo "Prochaines étapes:"
echo "  1. Sélectionnez un pays sur l'écran de connexion"
echo "  2. Entrez un numéro WhatsApp"
echo "  3. Entrez l'URL du serveur"
echo "  4. Cliquez 'Se connecter'"
echo ""
echo "Pour voir les logs:"
echo "  adb logcat | grep KYC"
echo ""
echo "Pour effacer l'app:"
echo "  adb uninstall $PACKAGE_NAME"
