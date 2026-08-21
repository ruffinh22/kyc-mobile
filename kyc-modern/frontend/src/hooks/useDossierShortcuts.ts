import { useEffect } from 'react';

interface ShortcutMap {
  /** T — ouvrir le transfert sur le dossier sélectionné */
  onTransferer?: () => void;
  /** ↓ / J — dossier suivant dans la liste */
  onSuivant?: () => void;
  /** ↑ / K — dossier précédent dans la liste */
  onPrecedent?: () => void;
  /** Entrée — ouvrir le détail du dossier survolé/sélectionné */
  onOuvrir?: () => void;
  /** Échap — fermer modal / désélectionner */
  onEchap?: () => void;
  /** R — rafraîchir la liste */
  onRafraichir?: () => void;
  enabled?: boolean;
}

/**
 * Raccourcis clavier pour le traitement rapide des dossiers en supervision :
 *   ↓/J suivant · ↑/K précédent · Entrée ouvrir · T transférer ·
 *   R rafraîchir · Échap fermer.
 *
 * Désactivés automatiquement quand le focus est dans un champ de saisie
 * (input/textarea/select ou contentEditable) pour ne jamais interférer
 * avec la frappe dans les filtres ou les formulaires.
 */
export function useDossierShortcuts({
  onTransferer, onSuivant, onPrecedent, onOuvrir, onEchap, onRafraichir, enabled = true,
}: ShortcutMap) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;

      if (e.key === 'Escape') { onEchap?.(); return; } // Échap marche même en saisie
      if (isTyping) return;

      switch (e.key.toLowerCase()) {
        case 'arrowdown': case 'j': onSuivant?.(); break;
        case 'arrowup':   case 'k': onPrecedent?.(); break;
        case 'enter':               onOuvrir?.(); break;
        case 't':                   onTransferer?.(); break;
        case 'r':                   onRafraichir?.(); break;
        default: return;
      }
      e.preventDefault();
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onTransferer, onSuivant, onPrecedent, onOuvrir, onEchap, onRafraichir, enabled]);
}
