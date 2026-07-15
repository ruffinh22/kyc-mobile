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
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
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
    public static final String ACTION_START = "START_CALL";
    public static final String ACTION_STOP  = "STOP_CALL";
    public static final String EXTRA_NUMBER = "numeroMtn";

    private static final int NOTIF_ID = 1001;

    private PowerManager.WakeLock wakeLock;

    // ── Démarrage du service ──────────────────────────────────────────────
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String action = intent.getAction();

        if (ACTION_START.equals(action)) {
            String numero = intent.getStringExtra(EXTRA_NUMBER);
            createNotificationChannel();
            Notification notif = buildNotification(numero != null ? numero : "…");
            startForegroundCompat(notif);
            acquireWakeLock();
            return START_STICKY;

        } else if (ACTION_STOP.equals(action)) {
            releaseWakeLock();
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
        }

        return START_NOT_STICKY;
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

    // ── Notification permanente pendant l'appel ───────────────────────────
    private Notification buildNotification(String numeroMtn) {
        Intent tapIntent = new Intent(this, MainActivity.class);
        tapIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            : PendingIntent.FLAG_UPDATE_CURRENT;

        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, tapIntent, flags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Appel KYC en cours")
            .setContentText("Numéro : " + numeroMtn)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();
    }

    // ── Canal de notification (Android 8+) ────────────────────────────────
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

            NotificationManager mgr = getSystemService(NotificationManager.class);
            if (mgr != null) mgr.createNotificationChannel(channel);
        }
    }

    // ── WakeLock : empêche le CPU de dormir pendant l'appel ──────────────
    private void acquireWakeLock() {
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
        Intent i = new Intent(ctx, KycForegroundCallService.class);
        i.setAction(ACTION_START);
        i.putExtra(EXTRA_NUMBER, numeroMtn);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    public static void stop(Context ctx) {
        Intent i = new Intent(ctx, KycForegroundCallService.class);
        i.setAction(ACTION_STOP);
        ctx.startService(i);
    }
}