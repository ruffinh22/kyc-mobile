package com.kycmobile;

import android.util.Log;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * CameraPackage - Enregistrement des modules natifs caméra
 * 
 * Architecture:
 *   - Implémente ReactPackage pour l'intégration React Native
 *   - Expose CameraModule comme NativeModule
 *   - Fournit intégration native pour caméra
 * 
 * Gestion:
 *   - Création singleton des modules
 *   - Logging pour débogage
 *   - Gestion du cycle de vie
 * 
 * @author KYC Mobile Team
 * @version 1.0.0
 */
public class CameraPackage implements ReactPackage {
    private static final String TAG = "CameraPackage";
    private static CameraModule cameraModule;
    
    @Override
    public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
        List<NativeModule> modules = new ArrayList<>();
        
        try {
            Log.d(TAG, "Creating native modules for ReactContext");
            
            if (cameraModule == null) {
                cameraModule = new CameraModule(reactContext);
                Log.d(TAG, "CameraModule created and registered");
            }
            
            modules.add(cameraModule);
            Log.i(TAG, "Successfully registered " + modules.size() + " native module(s)");
            
        } catch (Exception e) {
            Log.e(TAG, "Error creating native modules", e);
        }
        
        return modules;
    }

    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }
    
    /**
     * Obtenir le module caméra (pour accès direct si nécessaire)
     * 
     * @return Instance du CameraModule ou null
     */
    public static CameraModule getCameraModule() {
        return cameraModule;
    }
}
