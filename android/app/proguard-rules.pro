# React Native
-keep class com.facebook.react.devsupport.** { *; }
-keep class com.facebook.react.bridge.** { *; }

# Firebase
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# Expo / modules native
-keep class expo.modules.** { *; }
-keep class expo.modules.adapters.react.** { *; }
-keep class expo.modules.camera.** { *; }
-keep class com.kycmobile.** { *; }

# WebRTC
-keep class org.webrtc.** { *; }

# Permissions
-keepclasseswithmembernames class * {
    native <methods>;
}

# Expo Modules Core — requis, sinon crash au démarrage en release.
# Les modules Expo (CameraViewModule, etc.) sont instanciés par réflexion via
# NativeModulesProxy/ModuleRegistry. R8 doit préserver leurs classes ET leurs
# constructeurs sans argument, sinon: InstantiationException au runtime.
-keep class expo.modules.** { *; }
-keepclassmembers class expo.modules.** { *; }
-keep class * extends expo.modules.core.interfaces.Package
-keep class * extends expo.modules.kotlin.modules.Module

-keepclassmembers class * {
    public <init>();
}

-dontwarn expo.modules.**
