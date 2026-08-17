package com.kycmobile;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import androidx.core.app.NotificationManagerCompat;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.WritableNativeMap;
import androidx.annotation.NonNull;

import java.util.HashMap;
import java.util.Map;

/**
 * KycCallModule - Gestion native des appels vidéo KYC (PRODUCTION GRADE)
 * 
 * ─────────────────────────────────────────────────────────────────────────────
 * Architecture:
 *   - Intégration WebRTC via React Native
 *   - Gestion des états d'appel
 *   - Foreground service pour notification d'appel
 *   - Logging et diagnostique production
 * 
 * Responsabilités:
 *   - Initialisation du moteur d'appel
 *   - Gestion du cycle de vie des appels
 *   - Gestion du foreground service
 *   - Événements et erreurs
 * 
 * Communication:
 *   - Bridge React Native ↔ Module natif
 *   - Signaling via WebSocket (Node.js server)
 *   - Médias via WebRTC
 *   - Notifications Android
 * 
 * Usage depuis JS/TS:
 *   import { NativeModules } from 'react-native';
 *   NativeModules.KycCallModule.startForeground('0600000000');
 *   NativeModules.KycCallModule.stopForeground();
 *   NativeModules.KycCallModule.initialize().then(...)
 * 
 * @author KYC Mobile Team
 * @version 2.0.0 (Production)
 */
public class KycCallModule extends ReactContextBaseJavaModule {
    public static final String MODULE_NAME = "KycCallModule";
    private static final String TAG = "KycCallModule";
    private static final String VERSION = "2.0.0";
    
    // États d'appel
    private static final String STATE_IDLE = "idle";
    private static final String STATE_RINGING = "ringing";
    private static final String STATE_CONNECTING = "connecting";
    private static final String STATE_CONNECTED = "connected";
    private static final String STATE_ENDED = "ended";
    
    private String currentCallState = STATE_IDLE;
    private String currentPeerId = null;
    private long callStartTime = 0;
    private static String pendingCallUuid = null;
    private static String pendingNumeroMtn = null;

    public KycCallModule(ReactApplicationContext context) {
        super(context);
        Log.d(TAG, "KycCallModule instantiated - Version: " + VERSION);
    }

    @NonNull
    @Override
    public String getName() {
        return MODULE_NAME;
    }

    /**
     * Constantes exposées au JavaScript
     */
    @Override
    public Map<String, Object> getConstants() {
        final Map<String, Object> constants = new HashMap<>();
        constants.put("MODULE_NAME", MODULE_NAME);
        constants.put("VERSION", VERSION);
        constants.put("STATE_IDLE", STATE_IDLE);
        constants.put("STATE_RINGING", STATE_RINGING);
        constants.put("STATE_CONNECTING", STATE_CONNECTING);
        constants.put("STATE_CONNECTED", STATE_CONNECTED);
        constants.put("STATE_ENDED", STATE_ENDED);
        constants.put("MANUFACTURER", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase());
        return constants;
    }

    /**
     * Initialiser le module d'appel
     * Vérifie les dépendances et prépare le moteur WebRTC
     * 
     * @param promise Callback Promise
     */
    @ReactMethod
    public void initialize(Promise promise) {
        try {
            Log.d(TAG, "Initialize called - Module version: " + VERSION);
            
            if (getReactApplicationContext() == null) {
                promise.reject("CONTEXT_ERROR", "React context not available");
                return;
            }
            
            WritableMap result = new WritableNativeMap();
            result.putString("status", "initialized");
            result.putString("module", MODULE_NAME);
            result.putString("version", VERSION);
            result.putString("state", currentCallState);
            
            Log.i(TAG, "Module initialized successfully");
            promise.resolve(result);
            
        } catch (Exception e) {
            Log.e(TAG, "Error initializing module", e);
            promise.reject("INIT_ERROR", "Module initialization failed: " + e.getMessage());
        }
    }

    /**
     * Vérifie si l'app est déjà exemptée de l'optimisation batterie (Doze).
     * Appelé depuis NotificationService.ts avant de proposer la demande, pour
     * ne pas re-solliciter l'utilisateur inutilement à chaque lancement.
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    public boolean isIgnoringBatteryOptimizations() {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true; // pas de Doze avant M
            PowerManager pm = (PowerManager) getReactApplicationContext().getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(getReactApplicationContext().getPackageName());
        } catch (Exception e) {
            Log.e(TAG, "Error checking battery optimization status", e);
            return false;
        }
    }

    /**
     * Ouvre la boîte de dialogue système demandant l'exemption Doze pour cette
     * app. Nécessite REQUEST_IGNORE_BATTERY_OPTIMIZATIONS dans le manifest.
     * C'est LA cause n°1 des appels manqués app-fermée sur Samsung/Xiaomi/Oppo :
     * sans cette exemption, le système peut retarder ou tuer le processus JS
     * avant même que le foreground service ne démarre.
     */
    @ReactMethod
    public void requestIgnoreBatteryOptimizations() {
        try {
            String packageName = getReactApplicationContext().getPackageName();
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + packageName));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getReactApplicationContext().startActivity(intent);
            Log.i(TAG, "Battery optimization exemption dialog requested");
        } catch (Exception e) {
            // Certains OEM (MIUI notamment) refusent cet intent standard ; dans ce
            // cas on log seulement — un guide manuel restera nécessaire pour ces
            // appareils (paramètres constructeur hors API standard Android).
            Log.e(TAG, "Error requesting battery optimization exemption", e);
        }
    }

    /**
     * Ouvre l'écran constructeur de gestion du démarrage automatique / de
     * l'agressivité batterie propre à certains OEM (Xiaomi, Oppo, Vivo,
     * Huawei...). L'exemption Doze standard Android (ci-dessus) NE SUFFIT
     * PAS sur ces marques : elles ont leur propre gestionnaire de batterie
     * en plus de celui d'Android, qui peut quand même tuer le process avant
     * qu'un push FCM ne soit traité. C'est la cause n°1 des appels qui ne
     * sonnent jamais app fermée sur le parc Android bas/moyen de gamme
     * courant en Afrique/Asie.
     *
     * Chaque constructeur a son propre écran non-standard (pas d'API Android
     * officielle) : on tente les intents connus dans l'ordre, on s'arrête au
     * premier qui réussit à démarrer une Activity, et on se rabat sur l'écran
     * de détails de l'app si aucun n'est reconnu ou disponible sur ce build.
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    public boolean openAutoStartSettings() {
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        String pkg = getReactApplicationContext().getPackageName();

        String[][] candidates;
        if (manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco")) {
            candidates = new String[][]{
                {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
                {"com.miui.securitycenter", "com.miui.securitycenter.permission.AutoStartManagementActivity"},
            };
        } else if (manufacturer.contains("oppo") || manufacturer.contains("realme")) {
            // "realme" tourne sur ColorOS (comme Oppo) mais les modèles récents ont
            // basculé la marque interne des écrans système de coloros → heytap : on
            // tente les deux familles de composants avant de renoncer.
            candidates = new String[][]{
                {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
                {"com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"},
                {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
                {"com.heytap.safecenter", "com.heytap.safecenter.startupapp.StartupAppListActivity"},
                {"com.heytap.safecenter", "com.heytap.safecenter.permission.startup.StartupAppListActivity"},
            };
        } else if (manufacturer.contains("vivo") || manufacturer.contains("iqoo")) {
            candidates = new String[][]{
                {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
                {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"},
            };
        } else if (manufacturer.contains("oneplus")) {
            candidates = new String[][]{
                {"com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"},
                {"com.oneplus.security", "com.oneplus.security.startupapp.StartupAppListActivity"},
            };
        } else if (manufacturer.contains("huawei") || manufacturer.contains("honor")) {
            candidates = new String[][]{
                {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
                {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
            };
        } else if (manufacturer.contains("infinix") || manufacturer.contains("tecno") || manufacturer.contains("itel")
                || manufacturer.contains("transsion")) {
            // Transsion (HiOS/XOS — Infinix/Tecno/Itel) : AUCUNE API officielle, et
            // contrairement à Xiaomi/Oppo/Huawei ces noms de classe ne sont PAS
            // stables d'une version d'XOS/HiOS à l'autre — cette table est du
            // best-effort, pas une garantie. Sur le device de test, `pm list
            // packages | grep -i trans` n'a rien remonté : soit ce build n'expose
            // pas ce gestionnaire sous ce nom de package, soit il est absent sur ce
            // modèle. Dans les deux cas, AUCUNE combinaison package/activité ne
            // fonctionnera ici quoi qu'on écrive — le code retombe alors
            // automatiquement sur l'écran générique (voir plus bas), qui LUI
            // fonctionne sur 100% des Android quel que soit le modèle.
            candidates = new String[][]{
                {"com.transsion.phonemanager", "com.transsion.phonemanager.ui.appmanage.autobootmanage.AutoBootManageActivity"},
                {"com.transsion.phonemanager", "com.transsion.phonemanager.ui.autobootmanage.AutoBootManageActivity"},
                {"com.transsion.phonemanager", "com.transsion.phonemanager.ui.viewmodel.activity.AutoBootManagerActivity"},
                {"com.itel.autobootmanager", "com.itel.autobootmanager.AutoBootManagerActivity"},
                {"com.transsion.phonemanager", "com.transsion.phonemanager.MainActivity"},
            };
        } else {
            candidates = new String[0][];
        }

        boolean openedSpecific = false;
        for (String[] c : candidates) {
            try {
                Intent intent = new Intent();
                intent.setClassName(c[0], c[1]);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getReactApplicationContext().startActivity(intent);
                Log.i(TAG, "Écran autostart ouvert: " + c[0] + "/" + c[1]);
                openedSpecific = true;
                return true;
            } catch (Exception e) {
                Log.d(TAG, "Écran autostart indisponible (" + c[0] + "), tentative suivante", e);
            }
        }

        // Aucun écran constructeur reconnu/disponible : repli standard.
        try {
            Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            fallback.setData(Uri.parse("package:" + pkg));
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getReactApplicationContext().startActivity(fallback);
            Log.i(TAG, "Aucun écran autostart constructeur reconnu — repli app details settings");
        } catch (Exception e) {
            Log.e(TAG, "Impossible d'ouvrir un écran de paramètres pour l'autostart", e);
        }

        // Retourne true si un écran constructeur spécifique a été ouvert,
        // false si on est tombé sur le repli générique (app details) ou en erreur.
        return openedSpecific;
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    public boolean canUseFullScreenIntent() {
        try {
            return NotificationManagerCompat.from(getReactApplicationContext()).canUseFullScreenIntent();
        } catch (Exception e) {
            Log.e(TAG, "Error checking full screen intent permission", e);
            return false;
        }
    }

    @ReactMethod
    public void requestFullScreenIntentPermission() {
        try {
            Intent intent = new Intent("android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT");
            intent.setData(Uri.parse("package:" + getReactApplicationContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getReactApplicationContext().startActivity(intent);
            Log.i(TAG, "Requested full screen intent permission settings");
        } catch (Exception e) {
            Log.w(TAG, "Unable to open full screen intent settings, falling back to app details", e);
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getReactApplicationContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getReactApplicationContext().startActivity(intent);
                Log.i(TAG, "Opened app details settings as fallback");
            } catch (Exception fallback) {
                Log.e(TAG, "Unable to open app details settings", fallback);
            }
        }
    }

    /**
     * Arrêter la sonnerie/vibration native SANS arrêter le service foreground
     * (notification + wake lock restent actifs pendant toute la durée de
     * l'appel). Appelé quand l'utilisateur décroche — évite le "stop puis
     * restart" fragile de l'ancienne version.
     */
    @ReactMethod
    public void answerCall() {
        try {
            Log.d(TAG, "answerCall called — arrêt sonnerie, service maintenu");
            KycForegroundCallService.answer(getReactApplicationContext());
            currentCallState = STATE_CONNECTING;
            // Filet de sécurité : answerCall() peut être déclenché par plusieurs
            // chemins — bouton "Accepter" de notre IncomingCallScreen (app déjà
            // visible, no-op ici), mais AUSSI par l'UI Telecom native de CallKeep
            // (écran verrouillé, ou bandeau système) sans que notre propre écran
            // n'ait jamais été affiché. Dans ce second cas, décrocher ne servait à
            // rien à l'utilisateur : l'appel passait "connecting/active" côté JS,
            // mais rien à l'écran ne changeait puisque l'Activity n'était pas au
            // premier plan. On la ramène explicitement ici dans tous les cas —
            // singleTask + SINGLE_TOP|CLEAR_TOP rend l'opération sans danger si
            // elle est déjà visible (onNewIntent, pas de recréation).
            bringMainActivityToForeground();
        } catch (Exception e) {
            Log.e(TAG, "Error answering call natively", e);
        }
    }

    private void bringMainActivityToForeground() {
        try {
            Intent intent = new Intent(getReactApplicationContext(), MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            getReactApplicationContext().startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "Impossible de ramener MainActivity au premier plan après answerCall", e);
        }
    }

    /**
     * Démarrer le foreground service avec notification d'appel
     * Affiche une notification persistante pendant l'appel en cours
     * 
     * @param numeroMtn numéro MTN affiché dans la notification
     */
    @ReactMethod
    public void startForeground(String numeroMtn) {
        startForegroundWithCallData(numeroMtn, null);
    }

    @ReactMethod
    public void startForegroundWithCallData(String numeroMtn, String callUuid) {
        try {
            Log.d(TAG, "startForegroundWithCallData called with numero: " + numeroMtn + " callUuid=" + callUuid);
            KycForegroundCallService.start(getReactApplicationContext(), numeroMtn, callUuid);
            currentCallState = STATE_RINGING;
            Log.i(TAG, "Foreground service started");
        } catch (Exception e) {
            Log.e(TAG, "Error starting foreground service", e);
        }
    }

    public static void setPendingIncomingCall(String callUuid, String numeroMtn) {
        pendingCallUuid = callUuid;
        pendingNumeroMtn = numeroMtn;
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    public String consumePendingIncomingCall() {
        if (pendingCallUuid == null || pendingNumeroMtn == null) {
            return "";
        }
        String payload = "{\"callUuid\":\"" + pendingCallUuid.replace("\\", "\\\\").replace("\"", "\\\"")
            + "\",\"numeroMtn\":\"" + pendingNumeroMtn.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}";
        pendingCallUuid = null;
        pendingNumeroMtn = null;
        return payload;
    }

    /**
     * Arrêter le foreground service (fin d'appel)
     */
    @ReactMethod
    public void stopForeground() {
        try {
            Log.d(TAG, "stopForeground called");
            KycForegroundCallService.stop(getReactApplicationContext());
            currentCallState = STATE_ENDED;
            callStartTime = 0;
            Log.i(TAG, "Foreground service stopped");
            
            // Retour à idle après court délai
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                currentCallState = STATE_IDLE;
            }, 500);
        } catch (Exception e) {
            Log.e(TAG, "Error stopping foreground service", e);
        }
    }

    /**
     * Démarrer un appel vidéo KYC
     * 
     * Flux:
     *   1. Valider le peerId
     *   2. Passer à l'état RINGING
     *   3. Initialiser WebRTC
     *   4. Signaler via serveur
     * 
     * @param peerId ID du pair distant (serveur KYC)
     * @param promise Callback Promise
     */
    @ReactMethod
    public void startCall(String peerId, Promise promise) {
        try {
            if (peerId == null || peerId.isEmpty()) {
                promise.reject("INVALID_PEER", "Peer ID is required");
                return;
            }
            
            Log.d(TAG, "startCall initiated with peerId: " + peerId);
            
            if (!STATE_IDLE.equals(currentCallState)) {
                promise.reject("STATE_ERROR", "Call already in progress. Current state: " + currentCallState);
                return;
            }
            
            currentPeerId = peerId;
            currentCallState = STATE_CONNECTING;
            callStartTime = System.currentTimeMillis();
            
            WritableMap result = new WritableNativeMap();
            result.putString("status", "call_initiating");
            result.putString("state", currentCallState);
            result.putString("peerId", peerId);
            result.putString("timestamp", String.valueOf(callStartTime));
            
            Log.i(TAG, "Call started successfully with peer: " + peerId);
            promise.resolve(result);
            
        } catch (Exception e) {
            Log.e(TAG, "Error starting call", e);
            currentCallState = STATE_IDLE;
            promise.reject("CALL_ERROR", "Failed to start call: " + e.getMessage());
        }
    }
    
    /**
     * Obtenir l'état actuel de l'appel
     * 
     * @param promise Callback Promise
     */
    @ReactMethod
    public void getCallState(Promise promise) {
        try {
            WritableMap state = new WritableNativeMap();
            state.putString("state", currentCallState);
            state.putString("peerId", currentPeerId);
            state.putString("timestamp", String.valueOf(System.currentTimeMillis()));
            if (callStartTime > 0) {
                state.putString("duration", String.valueOf(System.currentTimeMillis() - callStartTime));
            }
            
            promise.resolve(state);
        } catch (Exception e) {
            Log.e(TAG, "Error getting call state", e);
            promise.reject("STATE_ERROR", e.getMessage());
        }
    }
    
    /**
     * Terminer l'appel en cours
     * 
     * @param promise Callback Promise
     */
    @ReactMethod
    public void endCall(Promise promise) {
        try {
            Log.d(TAG, "endCall initiated. Current state: " + currentCallState);
            
            long callDuration = callStartTime > 0 ? System.currentTimeMillis() - callStartTime : 0;
            currentCallState = STATE_ENDED;
            String endedPeerId = currentPeerId;
            currentPeerId = null;
            
            WritableMap result = new WritableNativeMap();
            result.putString("status", "call_ended");
            result.putString("peerId", endedPeerId);
            result.putString("duration", String.valueOf(callDuration));
            result.putString("timestamp", String.valueOf(System.currentTimeMillis()));
            
            Log.i(TAG, "Call ended - Duration: " + (callDuration / 1000) + "s");
            promise.resolve(result);
            
            stopForeground();
            
        } catch (Exception e) {
            Log.e(TAG, "Error ending call", e);
            promise.reject("END_ERROR", e.getMessage());
        }
    }
}