import { Injectable, inject } from '@angular/core';
import {
  PushNotifications,
  Token,
  PushNotificationSchema,
  ActionPerformed,
} from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { API_CONFIG } from '../config/api.config';

// Requiere configurar Firebase Cloud Messaging:
//   1. Crea proyecto en Firebase Console → Agrega app Android con appId cl.vayo.mobile
//   2. Descarga google-services.json → colócalo en android/app/
//   3. Asegura que los plugins Gradle de Google Services están en android/build.gradle
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly api  = inject(ApiService);
  private readonly auth = inject(AuthService);

  async init(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    const result = await PushNotifications.requestPermissions();
    if (result.receive !== 'granted') return;

    await PushNotifications.register();

    PushNotifications.addListener('registration', (token: Token) => {
      if (this.auth.isLoggedIn()) {
        this.api.post(API_CONFIG.endpoints.devicesPushToken, {
          token: token.value, platform: 'android',
        }).subscribe();
      }
    });

    PushNotifications.addListener('pushNotificationReceived', (_: PushNotificationSchema) => {
      // Notificación recibida en primer plano — se puede mostrar toast/badge
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (_: ActionPerformed) => {
      // Usuario tocó la notificación — navegar según data.quoteId / data.type
    });
  }
}
