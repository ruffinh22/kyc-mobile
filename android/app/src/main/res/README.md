# Icône de l'app — KYC Mobile

Badge d'origine recentré sur un fond uni **bleu marine MTN** (`#003087`, token `C.blue`),
avec un fin liseré **doré** (`#FFCC00`, token `C.yellow`) qui reprend le motif du sceau
utilisé sur l'écran d'attente (IdleScreen).

## Où copier les fichiers

Copie chaque dossier `mipmap-*` directement dans `android/app/src/main/res/` de ton
projet (il remplace les `ic_launcher.png` / `ic_launcher_round.png` existants) :

```
android/app/src/main/res/
  mipmap-mdpi/ic_launcher.png        (48×48)
  mipmap-mdpi/ic_launcher_round.png
  mipmap-hdpi/...                    (72×72)
  mipmap-xhdpi/...                   (96×96)
  mipmap-xxhdpi/...                  (144×144)
  mipmap-xxxhdpi/...                 (192×192)
```

## Play Store

`playstore/ic_launcher-playstore.png` (512×512, sans transparence) → à uploader dans
la fiche de l'application sur Google Play Console.

## Icône adaptative (Android 8+)

`mipmap-anydpi-v26-source/` contient les deux calques source (432×432, résolution
xxxhdpi) :
- `ic_launcher_foreground.png` — le badge seul, fond transparent
- `ic_launcher_background.png` — aplat marine uni

Le plus simple : dans Android Studio → clic droit sur `res` → *New ▸ Image Asset* →
choisis ces deux images comme foreground/background. Android Studio générera alors
automatiquement le `mipmap-anydpi-v26/ic_launcher.xml` et toutes les tailles
intermédiaires pour toi.
