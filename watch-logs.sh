#!/bin/bash
# watch-logs.sh
# Affiche les logs KYC en temps réel
# Usage: ./watch-logs.sh [--all] [--clear]

SHOW_ALL=false
CLEAR_FIRST=false

for arg in "$@"; do
  case $arg in
    --all)
      SHOW_ALL=true
      ;;
    --clear)
      CLEAR_FIRST=true
      ;;
  esac
done

if [ "$CLEAR_FIRST" = true ]; then
  adb logcat -c
  echo "Logs effacés"
fi

echo "Affichage des logs KYC (Ctrl+C pour arrêter)..."
echo ""

if [ "$SHOW_ALL" = true ]; then
  # Afficher tous les logs
  adb logcat -v time | grep -E "KYC|SignalingService|NotificationService|health|WebSocket|FATAL|Exception|E\/|W\/"
else
  # Afficher seulement les logs KYC
  adb logcat -v time | grep -E "KYC|health"
fi
