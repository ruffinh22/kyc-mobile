package com.kycmobile;
import expo.modules.ReactActivityDelegateWrapper;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.facebook.react.ReactActivity;
import com.facebook.react.ReactActivityDelegate;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactActivityDelegate;

public class MainActivity extends ReactActivity {

    @Override
    protected String getMainComponentName() {
        return "KycMobile";
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(null);

        Intent intent = getIntent();
        if (intent != null) {
            String callUuid = intent.getStringExtra("callUuid");
            String numeroMtn = intent.getStringExtra("numeroMtn");
            if (callUuid != null && numeroMtn != null) {
                KycCallModule.setPendingIncomingCall(callUuid, numeroMtn);
            }
        }

        applyLockScreenWakeFlags();
    }

    // ── Allume l'écran et affiche par-dessus le keyguard ──────────────────
    // Nécessaire pour l'écran d'appel entrant sur Android 8+.
    //
    // IMPORTANT : appelé depuis onCreate() ET onNewIntent(). L'Activity est
    // déclarée launchMode="singleTask" (voir AndroidManifest.xml) : si le
    // process de l'app est déjà vivant (app en arrière-plan, pas tuée) quand
    // un appel arrive, Android réutilise l'Activity existante et déclenche
    // onNewIntent() SANS jamais rappeler onCreate(). Avant ce correctif, les
    // flags de réveil n'étaient posés que dans onCreate() — un appel entrant
    // dans ce scénario (app déjà en arrière-plan + écran verrouillé) ne
    // réveillait donc pas l'écran, alors que le cas "app totalement tuée"
    // fonctionnait (onCreate() y est bien appelé).
    private void applyLockScreenWakeFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            );
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON   |
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            );
        }
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null) {
            String callUuid = intent.getStringExtra("callUuid");
            String numeroMtn = intent.getStringExtra("numeroMtn");
            if (callUuid != null && numeroMtn != null) {
                KycCallModule.setPendingIncomingCall(callUuid, numeroMtn);
            }
        }
        applyLockScreenWakeFlags();
    }

    @Override
    protected ReactActivityDelegate createReactActivityDelegate() {
        return new ReactActivityDelegateWrapper(this, BuildConfig.IS_NEW_ARCHITECTURE_ENABLED, new DefaultReactActivityDelegate(
            this,
            getMainComponentName(),
            DefaultNewArchitectureEntryPoint.getFabricEnabled()
        ));
    }
}