import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { API_CONFIG } from '../config/api.config';
import { ApiFavorite, ApiResponse } from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class FavoriteService {
  private readonly api  = inject(ApiService);
  private readonly auth = inject(AuthService);

  private readonly _ids = signal<Set<string>>(new Set());

  readonly favoriteIds = this._ids.asReadonly();
  readonly count       = computed(() => this._ids().size);

  isFavorite(productId: string): boolean {
    return this._ids().has(productId);
  }

  loadFavoriteIds(): void {
    if (!this.auth.isLoggedIn()) return;
    this.api.get<ApiResponse<ApiFavorite[]>>(API_CONFIG.endpoints.favorites).subscribe({
      next: res => {
        if (res.ok) {
          this._ids.set(new Set((res.data ?? []).map(f => f.productId)));
        }
      },
    });
  }

  toggle(productId: string): Observable<ApiResponse<null>> {
    if (this._ids().has(productId)) {
      return this.api.delete<ApiResponse<null>>(
        `${API_CONFIG.endpoints.favorites}/${productId}`,
      ).pipe(
        tap(res => {
          if (res.ok) {
            this._ids.update(s => { const n = new Set(s); n.delete(productId); return n; });
          }
        }),
      );
    }
    return this.api.post<ApiResponse<null>>(
      `${API_CONFIG.endpoints.favorites}/${productId}`, {},
    ).pipe(
      tap(res => {
        if (res.ok) {
          this._ids.update(s => new Set([...s, productId]));
        }
      }),
    );
  }
}
