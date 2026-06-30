import { Component, OnInit, inject, signal } from '@angular/core';
import { IonApp, IonRouterOutlet, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { wifiOutline } from 'ionicons/icons';
import { AuthService } from './core/services/auth.service';
import { NetworkService } from './core/services/network.service';
import { CartSyncService } from './core/services/cart-sync.service';
import { PushService } from './core/services/push.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet, IonIcon],
})
export class AppComponent implements OnInit {
  private readonly auth        = inject(AuthService);
  readonly network             = inject(NetworkService);
  private readonly cartSync    = inject(CartSyncService);
  private readonly pushService = inject(PushService);

  constructor() {
    addIcons({ wifiOutline });
  }

  async ngOnInit(): Promise<void> {
    void this.auth.init().catch((error) => {
      console.error('[App] Error inicializando sesion:', error);
    });

    await this.network.init().catch((error) => {
      console.error('[App] Error inicializando red:', error);
    });

    try {
      this.cartSync.init();
    } catch (error) {
      console.error('[App] Error inicializando sincronizacion de carrito:', error);
    }

    void this.pushService.init().catch((error) => {
      console.error('[App] Error inicializando push:', error);
    });
  }
}
