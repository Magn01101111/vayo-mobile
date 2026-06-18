import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

const KEY_TOKEN = 'vayo_token';
const KEY_USER  = 'vayo_user';

@Injectable({ providedIn: 'root' })
export class StorageService {
  async getToken(): Promise<string | null> {
    const { value } = await Preferences.get({ key: KEY_TOKEN });
    return value;
  }

  async setToken(token: string): Promise<void> {
    await Preferences.set({ key: KEY_TOKEN, value: token });
  }

  async getUser<T>(): Promise<T | null> {
    const { value } = await Preferences.get({ key: KEY_USER });
    return value ? (JSON.parse(value) as T) : null;
  }

  async setUser<T>(user: T): Promise<void> {
    await Preferences.set({ key: KEY_USER, value: JSON.stringify(user) });
  }

  async clear(): Promise<void> {
    await Preferences.remove({ key: KEY_TOKEN });
    await Preferences.remove({ key: KEY_USER });
  }
}
