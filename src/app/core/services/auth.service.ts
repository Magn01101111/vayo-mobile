import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';
import { StorageService } from './storage.service';
import { API_CONFIG } from '../config/api.config';
import {
  AuthUser,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  PasswordResetConfirm,
  PasswordResetRequest,
  RegisterRequest,
} from '../models/auth.models';
import { ApiResponse } from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api     = inject(ApiService);
  private readonly storage = inject(StorageService);

  private readonly _user  = signal<AuthUser | null>(null);
  private readonly _ready = signal(false);

  readonly user       = this._user.asReadonly();
  readonly ready      = this._ready.asReadonly();
  readonly isLoggedIn = computed(() => this._user() !== null);
  readonly isGuest    = computed(() => this._user() === null);

  async init(): Promise<void> {
    const stored = await this.storage.getUser<AuthUser>();
    if (stored) this._user.set(stored);
    this._ready.set(true);
  }

  login(req: LoginRequest): Observable<LoginResponse> {
    return this.api.post<LoginResponse>(API_CONFIG.endpoints.login, req).pipe(
      tap(async res => {
        await this.storage.setToken(res.token);
        await this.storage.setUser(res.user);
        this._user.set(res.user);
      }),
    );
  }

  register(req: RegisterRequest): Observable<LoginResponse> {
    return this.api.post<LoginResponse>(API_CONFIG.endpoints.register, req).pipe(
      tap(async res => {
        await this.storage.setToken(res.token);
        await this.storage.setUser(res.user);
        this._user.set(res.user);
      }),
    );
  }

  logout(): Observable<ApiResponse<null>> {
    return this.api.post<ApiResponse<null>>(API_CONFIG.endpoints.logout, {}).pipe(
      tap(() => this.clearSession()),
    );
  }

  me(): Observable<ApiResponse<AuthUser>> {
    return this.api.get<ApiResponse<AuthUser>>(API_CONFIG.endpoints.me);
  }

  updateProfile(data: Partial<AuthUser>): Observable<ApiResponse<AuthUser>> {
    return this.api.patch<ApiResponse<AuthUser>>(API_CONFIG.endpoints.me, data).pipe(
      tap(res => {
        if (res.ok) {
          this._user.set(res.data);
          void this.storage.setUser(res.data);
        }
      }),
    );
  }

  changePassword(req: ChangePasswordRequest): Observable<ApiResponse<null>> {
    return this.api.put<ApiResponse<null>>(API_CONFIG.endpoints.changePassword, req);
  }

  requestPasswordReset(req: PasswordResetRequest): Observable<ApiResponse<null>> {
    return this.api.post<ApiResponse<null>>(API_CONFIG.endpoints.passwordResetRequest, req);
  }

  confirmPasswordReset(req: PasswordResetConfirm): Observable<ApiResponse<null>> {
    return this.api.post<ApiResponse<null>>(API_CONFIG.endpoints.passwordResetConfirm, req);
  }

  uploadProfilePhoto(file: File): Observable<ApiResponse<AuthUser>> {
    const fd = new FormData();
    fd.append('photo', file);
    return this.api.patchForm<ApiResponse<AuthUser>>(API_CONFIG.endpoints.mePhoto, fd).pipe(
      tap(res => {
        if (res.ok) {
          this._user.set(res.data);
          void this.storage.setUser(res.data);
        }
      }),
    );
  }

  clearSession(): void {
    void this.storage.clear();
    this._user.set(null);
  }
}
