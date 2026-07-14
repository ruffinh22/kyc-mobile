#!/bin/bash
# test-local-server.sh
# Teste le serveur local KYC sans l'app
# Usage: ./test-local-server.sh [HOST:PORT]

HOST=${1:-localhost:3000}

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  🧪 Test Serveur Local KYC                    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}\n"

echo -e "${CYAN}Cible: ${GREEN}$HOST${NC}\n"

# Test 1: Health
echo -e "${YELLOW}→ Test 1: GET /health${NC}"
HEALTH=$(curl -s -w "\n%{http_code}" "http://$HOST/health")
HTTP_CODE=$(echo "$HEALTH" | tail -1)
BODY=$(echo "$HEALTH" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✓ Status: 200${NC}"
  echo -e "${GREEN}✓ Réponse: $BODY${NC}\n"
else
  echo -e "${RED}✗ Status: $HTTP_CODE${NC}"
  echo -e "${RED}✗ Le serveur n'est pas accessible${NC}"
  echo -e "${RED}✗ Vérifiez:${NC}"
  echo -e "   - Le serveur est lancé: ${CYAN}node local-server.js${NC}"
  echo -e "   - L'adresse est correcte: ${CYAN}$HOST${NC}"
  echo -e "   - La connexion internet fonctionne\n"
  exit 1
fi

# Test 2: Status
echo -e "${YELLOW}→ Test 2: GET /status${NC}"
STATUS=$(curl -s "http://$HOST/status")
echo -e "${GREEN}✓ $STATUS\n${NC}"

# Test 3: Terrains (devrait être vide au départ)
echo -e "${YELLOW}→ Test 3: GET /terrains${NC}"
TERRAINS=$(curl -s "http://$HOST/terrains")
echo -e "${GREEN}✓ $TERRAINS${NC}"

# Information sur comment connecter un terrain
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════${NC}"
echo -e "${CYAN}PROCHAINES ÉTAPES${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}1. Compiler et tester l'APK:${NC}"
echo -e "   ${GREEN}./build-and-install.sh${NC}\n"

echo -e "${YELLOW}2. Dans l'APK, utiliser:${NC}"
echo -e "   Serveur: ${GREEN}http://$HOST${NC}\n"

echo -e "${YELLOW}3. Déclencher un appel:${NC}"
echo -e "   ${GREEN}curl http://$HOST/call/065151234${NC}\n"

echo -e "${YELLOW}4. Voir les terrains connectés:${NC}"
echo -e "   ${GREEN}curl http://$HOST/terrains${NC}\n"

echo -e "${GREEN}✓ Serveur local fonctionnel!${NC}\n"
