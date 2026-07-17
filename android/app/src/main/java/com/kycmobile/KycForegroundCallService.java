package com.kycmobile;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * KycForegroundCallService
 * ─────────────────────────────────────────────────────────────────────────────
 * Service foreground Android qui maintient l'appel vidéo actif
 * même quand l'écran est verrouillé ou que l'app est en arrière-plan.
 *
 * Démarré depuis JS via NativeModules.KycCallModule.startForeground()
 * Arrêté à la fin de chaque appel.
 *
 * ── Sonnerie/vibration 100% natives (v2) ─────────────────────────────────
 * Avant : la sonnerie était jouée en JS (react-native-sound), ce qui exigeait
 * que le moteur JS soit déjà démarré et l'asset correctement chargé — fragile,
 * et en particulier en échec silencieux sur le tout premier appel app fermée
 * (le JS "headless" doit d'abord réinitialiser CallKeep avant de pouvoir jouer
 * un son, ce qui rate la fenêtre du tout premier push).
 * Maintenant : ce service natif joue lui-même la sonnerie (RingtoneManager sur
 * STREAM_RING, respecte donc le mode silencieux/DND comme un vrai appel) et la
 * vibration (Vibrator), dès ACTION_RING — c'est-à-dire dès que le push arrive,
 * indépendamment de l'état du moteur JS. C'est le comportement WhatsApp.
 *
 * Type foregroundServiceType="camera|microphone|phoneCall" déclaré dans le
 * manifest (requis Android 14+ / API 34 dès lors que le service reste actif
 * pendant que WebRTC capture la caméra/le micro). Ce type DOIT être répété au
 * runtime dans l'appel startForeground(id, notif, type) — voir
 * startForegroundCompat() ci-dessous — sinon le système lève une
 * MissingForegroundServiceTypeException et tue le service en plein appel.
 */
public class KycForegroundCallService extends Service {

    private static final String TAG = "KycForegroundCallService";
    public static final String CHANNEL_ID   = "kyc_call_channel";
    // ACTION_START conservé pour compat mais fait maintenant la même chose
    // qu'ACTION_RING (démarre le service + fait sonner) — voir KycCallModule.
    public static final String ACTION_START  = "START_CALL";
    public static final String ACTION_RING   = "RING_CALL";
    public static final String ACTION_ANSWER = "ANSWER_CALL";
    public static final String ACTION_STOP   = "STOP_CALL";
    public static final String EXTRA_NUMBER  = "numeroMtn";
    public static final String EXTRA_CALL_UUID = "callUuid";

    private static final long[] VIBRATION_PATTERN = {0, 700, 400, 700, 400, 900};
    private static final int NOTIF_ID = 1001;

    private PowerManager.WakeLock wakeLock;
    private MediaPlayer ringtonePlayer;
    private Vibrator vibrator;
    private String currentNumero = "…";
    private String currentCallUuid = null;

    // ── Démarrage du service ──────────────────────────────────────────────
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String action = intent.getAction();

        if (ACTION_START.equals(action) || ACTION_RING.equals(action)) {
            currentNumero = intent.getStringExtra(EXTRA_NUMBER);
            currentCallUuid = intent.getStringExtra(EXTRA_CALL_UUID);
            if (currentNumero == null) currentNumero = "…";
            createNotificationChannel();
            Notification notif = buildRingingNotification(currentNumero);
            startForegroundCompat(notif);
            acquireWakeLock();
            startNativeRingtone();
            startNativeVibration();
            launchIncomingCallActivity(currentNumero, currentCallUuid);
            return START_STICKY;

        } else if (ACTION_ANSWER.equals(action)) {
            // On décroche : on arrête sonnerie/vibration mais le service et le
            // wake lock restent actifs pour toute la durée de l'appel — on ne
            // recrée jamais le service, on met juste à jour la notification.
            stopNativeRingtone();
            stopNativeVibration();
            NotificationManager mgr = getSystemService(NotificationManager.class);
            if (mgr != null) mgr.notify(NOTIF_ID, buildActiveCallNotification(currentNumero));
            return START_STICKY;

        } else if (ACTION_STOP.equals(action)) {
            stopNativeRingtone();
            stopNativeVibration();
            releaseWakeLock();
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
        }

        return START_NOT_STICKY;
    }

    // ── Sonnerie native ──────────────────────────────────────────────────
    // STREAM_RING (pas STREAM_MUSIC) : respecte le volume sonnerie du
    // téléphone et le mode silencieux/Ne pas déranger, comme un vrai appel.
    // Priorité à la sonnerie KYC personnalisée (res/raw/sonneriekyc.mp3) ;
    // repli sur la sonnerie système par défaut si le fichier est absent
    // (ex. build fait avant l'ajout de la ressource).
    private void startNativeRingtone() {
        if (ringtonePlayer != null) return;
        try {
            Uri ringtoneUri = resolveCustomRingtoneUri();
            if (ringtoneUri == null) {
                ringtoneUri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_RINGTONE);
            }
            if (ringtoneUri == null) {
                ringtoneUri = RingtoneManager.getValidRingtoneUri(this);
            }
            if (ringtoneUri == null) {
                Log.w(TAG, "Aucune sonnerie disponible (ni custom, ni système)");
                return;
            }

            ringtonePlayer = new MediaPlayer();
            ringtonePlayer.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            ringtonePlayer.setDataSource(this, ringtoneUri);
            ringtonePlayer.setLooping(true);
            ringtonePlayer.setOnErrorListener((mp, what, extra) -> {
                Log.e(TAG, "Erreur lecture sonnerie (what=" + what + ", extra=" + extra + ")");
                stopNativeRingtone();
                return true;
            });
            ringtonePlayer.prepare();
            ringtonePlayer.start();
            Log.i(TAG, "Sonnerie native démarrée: " + ringtoneUri);
        } catch (Exception e) {
            Log.e(TAG, "Impossible de démarrer la sonnerie native", e);
            ringtonePlayer = null;
        }
    }

    // Résout res/raw/sonneriekyc.mp3 via getIdentifier (pas besoin de recompiler
    // R au moment où ce fichier Java est écrit) — renvoie null si la ressource
    // n'existe pas encore (ex. .mp3 pas encore copié dans le projet Android).
    @Nullable
    private Uri resolveCustomRingtoneUri() {
        try {
            int resId = getResources().getIdentifier("sonneriekyc", "raw", getPackageName());
            if (resId == 0) return null;
            return Uri.parse("android.resource://" + getPackageName() + "/" + resId);
        } catch (Exception e) {
            Log.w(TAG, "Ressource sonnerie custom introuvable, repli système", e);
            return null;
        }
    }

    private void stopNativeRingtone() {
        if (ringtonePlayer != null) {
            try {
                if (ringtonePlayer.isPlaying()) ringtonePlayer.stop();
                ringtonePlayer.release();
            } catch (Exception e) {
                Log.w(TAG, "Erreur arrêt sonnerie", e);
            }
            ringtonePlayer = null;
        }
    }

    // ── Vibration native (même motif que l'ancien CallSessionService.ts) ──
    private void startNativeVibration() {
        try {
            if (vibrator == null) vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(VIBRATION_PATTERN, 0)); // repeat=0 → boucle depuis l'index 0
            } else {
                vibrator.vibrate(VIBRATION_PATTERN, 0);
            }
        } catch (Exception e) {
            Log.e(TAG, "Impossible de démarrer la vibration native", e);
        }
    }

    private void stopNativeVibration() {
        try {
            if (vibrator != null) vibrator.cancel();
        } catch (Exception e) {
            Log.w(TAG, "Erreur arrêt vibration", e);
        }
    }

    // ── Démarrage foreground avec le bon type de service ──────────────────
    // Le type runtime doit être un sous-ensemble de celui déclaré dans le
    // manifest. On n'inclut CAMERA/MICROPHONE que si la permission correspondante
    // est réellement accordée à cet instant (sinon SecurityException garantie
    // sur API 34+) ; PHONE_CALL reste toujours inclus car c'est le rôle premier
    // de ce service (maintenir l'appel actif en arrière-plan).
    private void startForegroundCompat(Notification notif) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID, notif, resolveForegroundServiceType());
            } else {
                startForeground(NOTIF_ID, notif);
            }
        } catch (Exception e) {
            Log.e(TAG, "startForeground avec type a échoué, repli minimal", e);
            try {
                startForeground(NOTIF_ID, notif);
            } catch (Exception fatal) {
                Log.e(TAG, "Repli startForeground impossible — arrêt du service", fatal);
                stopSelf();
            }
        }
    }

    private int resolveForegroundServiceType() {
        int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            boolean hasCamera = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED;
            boolean hasMic = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;

            if (hasCamera) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
            if (hasMic)    type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;

            if (!hasCamera || !hasMic) {
                Log.w(TAG, "Permission caméra/micro manquante au démarrage du service "
                    + "— type foreground réduit à phoneCall (caméra=" + hasCamera + ", micro=" + hasMic + ")");
            }
        }
        return type;
    }

    private void launchIncomingCallActivity(String numeroMtn, String callUuid) {
        try {
            Intent activityIntent = new Intent(this, MainActivity.class);
            activityIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            activityIntent.putExtra("numeroMtn", numeroMtn);
            activityIntent.putExtra("callUuid", callUuid);
            startActivity(activityIntent);
            Log.i(TAG, "Activity d’appel entrant lancée depuis le service foreground");
        } catch (Exception e) {
            Log.w(TAG, "Impossible de lancer l’activité d’appel entrant", e);
        }
    }

    // ── Notification pendant la sonnerie ──────────────────────────────────
    private Notification buildRingingNotification(String numeroMtn) {
        return baseNotifBuilder(numeroMtn)
            .setContentTitle("Appel vidéo entrant")
            .setContentText("Numéro : " + numeroMtn)
            .build();
    }

    // ── Notification une fois l'appel décroché ────────────────────────────
    private Notification buildActiveCallNotification(String numeroMtn) {
        return baseNotifBuilder(numeroMtn)
            .setContentTitle("Appel KYC en cours")
            .setContentText("Numéro : " + numeroMtn)
            .build();
    }

    private NotificationCompat.Builder baseNotifBuilder(String numeroMtn) {
        Intent tapIntent = new Intent(this, MainActivity.class);
        tapIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (currentCallUuid != null) {
            tapIntent.putExtra(EXTRA_CALL_UUID, currentCallUuid);
        }
        if (currentNumero != null) {
            tapIntent.putExtra(EXTRA_NUMBER, currentNumero);
        }

        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            : PendingIntent.FLAG_UPDATE_CURRENT;

        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, tapIntent, flags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
    }

    // ── Canal de notification (Android 8+) ────────────────────────────────
    // IMPORTANT : le son est joué manuellement par ce service (MediaPlayer),
    // donc le canal ne doit PAS avoir son propre son par défaut — sinon deux
    // sonneries se chevauchent. setSound(null, null) désactive le son du canal.
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Appels KYC",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Appels vidéo de vérification KYC");
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setShowBadge(true);
            channel.setSound(null, null);
            channel.enableVibration(false); // vibration gérée manuellement (Vibrator), pas par le canal

            NotificationManager mgr = getSystemService(NotificationManager.class);
            if (mgr != null) mgr.createNotificationChannel(channel);
        }
    }

    // ── WakeLock : empêche le CPU de dormir pendant l'appel ──────────────
    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "KYCMobile::CallWakeLock"
            );
            wakeLock.acquire(60 * 60 * 1000L); // max 1 heure
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
        }
    }

    @Override
    public void onDestroy() {
        stopNativeRingtone();
        stopNativeVibration();
        releaseWakeLock();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ── Méthodes statiques (appelées depuis JS via NativeModule) ─────────
    public static void start(Context ctx, String numeroMtn) {
        ring(ctx, numeroMtn, null);
    }

    public static void start(Context ctx, String numeroMtn, String callUuid) {
        ring(ctx, numeroMtn, callUuid);
    }

    public static void ring(Context ctx, String numeroMtn) {
        ring(ctx, numeroMtn, null);
    }

    public static void ring(Context ctx, String numeroMtn, String callUuid) {
        Intent i = new Intent(ctx, KycForegroundCallService.class);
        i.setAction(ACTION_RING);
        i.putExtra(EXTRA_NUMBER, numeroMtn);
        if (callUuid != null) {
            i.putExtra(EXTRA_CALL_UUID, callUuid);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    public static void answer(Context ctx) {
        Intent i = new Intent(ctx, KycForegroundCallService.class);
        i.setAction(ACTION_ANSWER);
        ctx.startService(i);
    }

    public static void stop(Context ctx) {
        Intent i = new Intent(ctx, KycForegroundCallService.class);
        i.setAction(ACTION_STOP);
        ctx.startService(i);
    }
}