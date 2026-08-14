# React Native
-keep class com.facebook.react.bridge.** { *; }
# (com.facebook.react.devsupport.** retiré : menu debug RN, inutile en
# release, le garder ne fait qu'ajouter du poids pour rien)

# Firebase
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# WebRTC — utilise beaucoup de réflexion/JNI, doit rester intact
-keep class org.webrtc.** { *; }

# Ton propre code natif (bridge KYC, callkeep, foreground service...)
-keep class com.kycmobile.** { *; }

# Méthodes natives (JNI) — évite que R8 renomme des symboles requis côté C/C++
-keepclasseswithmembernames class * {
    native <methods>;
}

# ── Expo Modules Core — requis, sinon crash au démarrage en release. ──────
# Les modules Expo (CameraViewModule, etc.) sont instanciés par réflexion via
# NativeModulesProxy/ModuleRegistry. R8 doit préserver leurs classes ET leurs
# constructeurs sans argument, sinon: InstantiationException au runtime.
# Scope volontairement limité à expo.modules.** — PAS à "class *" global,
# sinon ça garde le constructeur public de TOUTE classe de l'app et de
# toutes les libs tierces, ce qui annule une bonne partie du gain de taille
# apporté par shrinkResources/minifyEnabled.
-keep class expo.modules.** { *; }
-keepclassmembers class expo.modules.** { *; }
-keep class * extends expo.modules.core.interfaces.Package
-keep class * extends expo.modules.kotlin.modules.Module
-keepclassmembers class expo.modules.** {
    public <init>();
}
-dontwarn expo.modules.**

# ── Fix R8 "Missing classes" : kotlinpoet / javax.lang.model ─────────────
# kotlinpoet (tiré par l'annotation processing d'une lib tierce, ex. Moshi
# codegen ou un module Expo) référence l'API du compilateur Java
# (javax.lang.model.*) — ces classes n'existent que dans le JDK, jamais sur
# Android, et le code qui les utilise n'est jamais exécuté au runtime
# (chemin d'annotation-processing pur, compile-time only). R8 échoue quand
# même dessus par défaut car il ne les trouve pas dans le classpath Android.
# -dontwarn les fait ignorer sans risque : rien de tout ça ne s'exécute
# jamais sur le téléphone.
-dontwarn javax.lang.model.**
-dontwarn javax.annotation.processing.**
-dontwarn com.squareup.kotlinpoet.**