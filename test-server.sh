#!/bin/bash
# test-server.sh
# Teste si un serveur KYC est accessible
# Usage: ./test-server.sh [URL]
# Exemples:
#   ./test-server.sh https://kyc.palladium-africa.com
#   ./test-server.sh http://192.168.1.100:8000

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

show_info() {
  echo -e "${BLUE}ℹ $1${NC}"
}

# Vérifier les paramètres
if [ $# -eq 0 ]; then
  show_header "Test d'Accessibilité du Serveur KYC"
  echo ""
  echo "Usage:"
  echo "  ./test-server.sh <URL>"
  echo ""
  echo "Exemples:"
  echo "  ./test-server.sh https://kyc.palladium-africa.com"
  echo "  ./test-server.sh http://192.168.1.100:8000"
  echo "  ./test-server.sh http://localhost:8000"
  echo ""
  exit 0
fi

URL="$1"

# Nettoyer l'URL (enlever trailing slash)
URL="${URL%/}"

show_header "Test d'Accessibilité"
show_info "URL testée: $URL"

# Test 1: Vérifier le format de l'URL
show_step "1. Vérification du format"
if [[ $URL =~ ^http(s)?:// ]]; then
  show_success "Format OK"
else
  show_error "Format invalide (doit commencer par http:// ou https://)"
  exit 1
fi

# Test 2: Tester le ping (DNS)
show_step "2. Résolution DNS"
HOSTNAME=$(echo "$URL" | sed -E 's|https?://([^/:]+).*|\1|')
if ping -c 1 -W 2 "$HOSTNAME" >/dev/null 2>&1; then
  show_success "Hôte accessible"
else
  show_error "Impossible de joindre l'hôte: $HOSTNAME"
  echo "Vérifiez:"
  echo "  - La connexion internet"
  echo "  - Le nom de domaine/IP"
  exit 1
fi

# Test 3: Tester la connexion HTTP
show_step "3. Connexion HTTP"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -L --connect-timeout 5 "$URL/health")
if [ "$HTTP_CODE" = "200" ]; then
  show_success "Endpoint /health accessible (HTTP $HTTP_CODE)"
else
  show_error "Erreur HTTP: $HTTP_CODE"
  echo "Codes courants:"
  echo "  200 = OK (serveur fonctionne)"
  echo "  404 = Endpoint /health non trouvé"
  echo "  500 = Erreur serveur"
  echo "  503 = Serveur indisponible"
  echo "  000 = Timeout ou erreur de connexion"
  exit 1
fi

# Test 4: Tester le contenu /health
show_step "4. Contenu du endpoint /health"
HEALTH_RESPONSE=$(curl -s -L --connect-timeout 5 "$URL/health")
show_info "Réponse: $HEALTH_RESPONSE"

if echo "$HEALTH_RESPONSE" | grep -q "ok\|success\|running"; then
  show_success "Serveur semble fonctionner"
else
  show_info "Réponse inattendue (peut être OK quand même)"
fi

# Test 5: Tester WebSocket (optionnel, plus complexe)
show_step "5. Vérification WebSocket"
WS_URL="${URL/https:/wss:}"
WS_URL="${WS_URL/http:/ws:}"
show_info "URL WebSocket: $WS_URL"
show_info "Le test WebSocket nécessite websocat (trop complexe ici)"

echo ""
show_success "✓ Tests complétés!"
echo ""
echo "Résumé:"
echo "  URL du serveur: $URL"
echo "  HTTP Health: OK"
echo ""
echo "Vous pouvez maintenant utiliser cette URL dans l'app KYC:"
echo "  1. Lancez l'app"
echo "  2. Sélectionnez un pays"
echo "  3. Entrez un numéro WhatsApp"
echo "  4. Entrez l'URL: $URL"
echo "  5. Cliquez 'Se connecter'"
echo ""
