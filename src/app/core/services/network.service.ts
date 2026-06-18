import { Injectable, signal } from '@angular/core';
import { Network } from '@capacitor/network';

@Injectable({ providedIn: 'root' })
export class NetworkService {
  readonly online = signal(true);

  async init(): Promise<void> {
    const status = await Network.getStatus();
    this.online.set(status.connected);

    Network.addListener('networkStatusChange', s => {
      this.online.set(s.connected);
    });
  }
}
