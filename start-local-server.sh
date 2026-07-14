#!/bin/bash
# start-local-server.sh
# Lance le serveur local KYC et affiche les infos d'accès

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Port
PORT=${1:-3000}
PROJECT_DIR="/home/lidruf/kyc-mobile"

echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  🖥️  Serveur Local KYC                         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}\n"

# Vérifier les dépendances
echo -e "${YELLOW}→ Vérification des dépendances...${NC}"
cd "$PROJECT_DIR"

# Vérifier si ws est installé
if ! yarn ls ws > /dev/null 2>&1; then
  echo -e "${YELLOW}→ Installation de 'ws'...${NC}"
  yarn add ws > /dev/null 2>&1
  echo -e "${GREEN}✓ 'ws' installé${NC}"
fi

# Obtenir l'IP locale
LOCAL_IP=$(ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | head -1 | awk '{print $2}' || echo "192.168.X.X")

echo -e "${GREEN}✓ Dépendances OK${NC}\n"

# Afficher les infos
echo -e "${CYAN}═══════════════════════════════════════════════${NC}"
echo -e "${CYAN}INFOS D'ACCÈS${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════${NC}\n"

echo -e "${BLUE}Serveur écoute sur:${NC}"
echo -e "  ${GREEN}http://0.0.0.0:${PORT}${NC}"
echo ""

echo -e "${BLUE}URL pour l'APK (depuis le téléphone):${NC}"
echo -e "  ${GREEN}http://${LOCAL_IP}:${PORT}${NC}"
echo ""

echo -e "${BLUE}Vérifier la connexion:${NC}"
echo -e "  ${GREEN}curl http://localhost:${PORT}/health${NC}"
echo ""

echo -e "${BLUE}Voir les terrains connectés:${NC}"
echo -e "  ${GREEN}curl http://localhost:${PORT}/terrains${NC}"
echo ""

echo -e "${BLUE}Déclencher un appel:${NC}"
echo -e "  ${GREEN}curl http://localhost:${PORT}/call/065151234${NC}"
echo ""

echo -e "${CYAN}═══════════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}📱 Utiliser dans l'app:${NC}"
echo -e "  1. Sélectionnez: ${GREEN}Congo (CG)${NC}"
echo -e "  2. Numéro: ${GREEN}065151234${NC}"
echo -e "  3. Serveur: ${GREEN}http://${LOCAL_IP}:${PORT}${NC}"
echo -e "  4. Cliquez: ${GREEN}Se connecter${NC}"
echo ""

echo -e "${YELLOW}⏹️  Arrêt: Appuyez sur Ctrl+C${NC}\n"

# Lancer le serveur
exec node "$PROJECT_DIR/local-server.js" "$PORT"
