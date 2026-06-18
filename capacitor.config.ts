import type { CapacitorConfig } from '@capacitor/cli';

// ── Checklist Play Store antes de `npx cap sync android` ──────────────────────
// 1. Icono:  resources/icon.png     (1024×1024 PNG, sin transparencia)
//            resources/icon-dark.png (1024×1024, fondo oscuro — opcional)
// 2. Splash: resources/splash.png   (2732×2732 PNG, centrado con padding)
//    → npm install @capacitor/assets --save-dev
//    → npx capacitor-assets generate
// 3. Colores: adaptiveIconForeground / backgroundColor alineados con --navy-900
// 4. Push:   android/app/google-services.json (descargar desde Firebase Console
//            proyecto cl.vayo.mobile, package name = cl.vayo.mobile)
// 5. Firma:  android/keystore.properties + jks antes de release build
// ──────────────────────────────────────────────────────────────────────────────

const config: CapacitorConfig = {
  appId:   'cl.vayo.mobile',
  appName: 'VAYO',
  webDir:  'www',

  plugins: {
    SplashScreen: {
      launchShowDuration:          2000,
      launchAutoHide:              true,
      backgroundColor:             '#0a1828',  // --navy-900
      androidSplashResourceName:   'splash',
      androidScaleType:            'CENTER_CROP',
      showSpinner:                 false,
      iosSpinnerStyle:             'small',
      splashFullScreen:            true,
      splashImmersive:             true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Camera: {
      permissions: ['camera', 'photos'],
    },
  },

  android: {
    allowMixedContent:            false,
    captureInput:                 true,
    webContentsDebuggingEnabled:  false,
    backgroundColor:              '#0a1828',   // --navy-900 (fondo mientras carga)
    loggingBehavior:              'none',
  },
};

export default config;
