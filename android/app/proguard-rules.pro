# React Native
-keep class com.facebook.react.devsupport.** { *; }
-keep class com.facebook.react.bridge.** { *; }

# Firebase
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# WebRTC
-keep class org.webrtc.** { *; }

# Permissions
-keepclasseswithmembernames class * {
    native <methods>;
}
