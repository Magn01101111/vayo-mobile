import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  IonContent, IonHeader, IonTitle, IonToolbar, IonSpinner, IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  personCircleOutline, logOutOutline, createOutline, lockClosedOutline,
  documentTextOutline, bagOutline, heartOutline, checkmarkCircle,
  cameraOutline, arrowBackOutline, chevronForwardOutline,
  refreshOutline, star, starOutline,
} from 'ionicons/icons';
import { AuthService } from '../../core/services/auth.service';
import { FavoriteService } from '../../core/services/favorite.service';
import { CatalogService } from '../../core/services/catalog.service';
import { QuoteService } from '../../core/services/quote.service';
import { ApiService } from '../../core/services/api.service';
import { API_CONFIG } from '../../core/config/api.config';
import { ApiQuote, ApiSale, ApiResponse } from '../../core/models/api.models';
import { ProductCardData } from '../../core/models/ui.models';
import { mapToProductCard } from '../../core/utils/product.mapper';

type AccountView = 'guest' | 'login' | 'register' | 'forgot' | 'forgot-sent' | 'profile';
type ProfileTab  = 'datos' | 'cotizaciones' | 'ventas' | 'favoritos';

@Component({
  selector: 'app-account',
  templateUrl: 'account.page.html',
  styleUrls: ['account.page.scss'],
  imports: [
    FormsModule,
    IonContent, IonHeader, IonTitle, IonToolbar, IonSpinner, IonIcon,
  ],
})
export class AccountPage implements OnInit {
  readonly auth    = inject(AuthService);
  readonly favSvc  = inject(FavoriteService);
  private readonly catalog = inject(CatalogService);
  private readonly qs      = inject(QuoteService);
  private readonly api     = inject(ApiService);
  private readonly router  = inject(Router);

  readonly view      = signal<AccountView>('guest');
  readonly activeTab = signal<ProfileTab>('datos');

  // ── Login ──────────────────────────────────────────────────────────────────
  loginEmail    = '';
  loginPassword = '';
  loginLoading  = signal(false);
  loginError    = signal('');

  // ── Registro ───────────────────────────────────────────────────────────────
  regName     = '';
  regEmail    = '';
  regPassword = '';
  regPhone    = '';
  regRut      = '';
  regLoading  = signal(false);
  regError    = signal('');

  // ── Recuperar contraseña ───────────────────────────────────────────────────
  forgotEmail   = '';
  forgotLoading = signal(false);
  forgotError   = signal('');

  // ── Perfil (edición) ───────────────────────────────────────────────────────
  profileName    = '';
  profilePhone   = '';
  profileEditing = signal(false);
  profileLoading = signal(false);
  profileError   = signal('');
  profileOk      = signal('');
  photoUploading = signal(false);

  // ── Cambio de contraseña ───────────────────────────────────────────────────
  pwdCurrent = '';
  pwdNew     = '';
  pwdConfirm = '';
  pwdSection = signal(false);
  pwdLoading = signal(false);
  pwdError   = signal('');
  pwdOk      = signal('');

  // ── Cotizaciones ───────────────────────────────────────────────────────────
  quotes        = signal<ApiQuote[]>([]);
  quotesLoading = signal(false);
  quotesError   = signal('');

  // ── Ventas ─────────────────────────────────────────────────────────────────
  sales        = signal<ApiSale[]>([]);
  salesLoading = signal(false);
  salesError   = signal('');

  // ── Favoritos ──────────────────────────────────────────────────────────────
  private readonly allProducts = signal<ProductCardData[]>([]);
  favLoading = signal(false);

  readonly favProducts = computed(() => {
    const ids = this.favSvc.favoriteIds();
    return this.allProducts().filter(p => ids.has(p.id));
  });

  constructor() {
    addIcons({
      personCircleOutline, logOutOutline, createOutline, lockClosedOutline,
      documentTextOutline, bagOutline, heartOutline, checkmarkCircle,
      cameraOutline, arrowBackOutline, chevronForwardOutline,
      refreshOutline, star, starOutline,
    });

    effect(() => {
      const loggedIn = this.auth.isLoggedIn();
      const v = this.view();
      if (loggedIn && v !== 'profile') {
        this.view.set('profile');
        this.loadHistorial();
      }
      if (!loggedIn && v === 'profile') {
        this.view.set('guest');
      }
    });
  }

  ngOnInit(): void {
    if (this.auth.isLoggedIn()) {
      this.view.set('profile');
      this.loadHistorial();
    }
  }

  // ── Navegación ─────────────────────────────────────────────────────────────
  goTo(v: AccountView): void { this.view.set(v); }

  setTab(t: ProfileTab): void {
    this.activeTab.set(t);
    if (t === 'favoritos' && this.allProducts().length === 0) this.loadFavorites();
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  login(): void {
    this.loginError.set('');
    if (!this.loginEmail || !this.loginPassword) {
      this.loginError.set('Completa correo y contraseña.');
      return;
    }
    this.loginLoading.set(true);
    this.auth.login({ email: this.loginEmail, password: this.loginPassword }).subscribe({
      next: () => { this.loginLoading.set(false); this.loginPassword = ''; },
      error: () => {
        this.loginLoading.set(false);
        this.loginError.set('Correo o contraseña incorrectos.');
      },
    });
  }

  // ── Registro ───────────────────────────────────────────────────────────────
  register(): void {
    this.regError.set('');
    if (!this.regName || !this.regEmail || !this.regPassword || !this.regRut) {
      this.regError.set('Nombre, correo, contraseña y RUT son obligatorios.');
      return;
    }
    this.regLoading.set(true);
    this.auth.register({
      name: this.regName, email: this.regEmail,
      password: this.regPassword, phone: this.regPhone, rut: this.regRut,
    }).subscribe({
      next: () => { this.regLoading.set(false); this.regPassword = ''; },
      error: (err) => {
        this.regLoading.set(false);
        this.regError.set((err?.error?.error as string) ?? 'Error al crear la cuenta.');
      },
    });
  }

  // ── Recuperar contraseña ───────────────────────────────────────────────────
  sendForgot(): void {
    this.forgotError.set('');
    if (!this.forgotEmail) { this.forgotError.set('Ingresa tu correo electrónico.'); return; }
    this.forgotLoading.set(true);
    this.auth.requestPasswordReset({ email: this.forgotEmail }).subscribe({
      next: () => { this.forgotLoading.set(false); this.view.set('forgot-sent'); },
      error: () => {
        this.forgotLoading.set(false);
        this.forgotError.set('Error al enviar. Verifica el correo ingresado.');
      },
    });
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  logout(): void {
    this.auth.logout().subscribe({ error: () => {} });
  }

  // ── Edición de perfil ──────────────────────────────────────────────────────
  startEditProfile(): void {
    const u = this.auth.user();
    this.profileName  = u?.name  ?? '';
    this.profilePhone = u?.phone ?? '';
    this.profileError.set('');
    this.profileOk.set('');
    this.profileEditing.set(true);
  }

  cancelEditProfile(): void { this.profileEditing.set(false); }

  saveProfile(): void {
    const name = this.profileName.trim();
    if (!name) { this.profileError.set('El nombre no puede estar vacío.'); return; }
    this.profileLoading.set(true);
    this.profileError.set('');
    this.auth.updateProfile({ name, phone: this.profilePhone.trim() || undefined }).subscribe({
      next: res => {
        this.profileLoading.set(false);
        if (res.ok) {
          this.profileEditing.set(false);
          this.profileOk.set('Perfil actualizado correctamente.');
          setTimeout(() => this.profileOk.set(''), 3000);
        } else {
          this.profileError.set((res as any).error ?? 'Error al guardar.');
        }
      },
      error: () => {
        this.profileLoading.set(false);
        this.profileError.set('Error de conexión. Intenta de nuevo.');
      },
    });
  }

  onPhotoSelected(ev: Event): void {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { this.profileError.set('La imagen no puede superar 2 MB.'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.profileError.set('Formato no permitido (JPG, PNG o WEBP).');
      return;
    }
    this.photoUploading.set(true);
    this.profileError.set('');
    this.auth.uploadProfilePhoto(file).subscribe({
      next: () => {
        this.photoUploading.set(false);
        this.profileOk.set('Foto de perfil actualizada.');
        setTimeout(() => this.profileOk.set(''), 3000);
      },
      error: () => {
        this.photoUploading.set(false);
        this.profileError.set('Error al subir la foto. Intenta de nuevo.');
      },
    });
    (ev.target as HTMLInputElement).value = '';
  }

  // ── Cambio de contraseña ───────────────────────────────────────────────────
  savePwd(): void {
    this.pwdError.set('');
    this.pwdOk.set('');
    if (!this.pwdCurrent || !this.pwdNew) {
      this.pwdError.set('Completa todos los campos.');
      return;
    }
    if (this.pwdNew !== this.pwdConfirm) {
      this.pwdError.set('Las contraseñas nuevas no coinciden.');
      return;
    }
    if (this.pwdNew.length < 6) {
      this.pwdError.set('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    this.pwdLoading.set(true);
    this.auth.changePassword({ currentPassword: this.pwdCurrent, newPassword: this.pwdNew }).subscribe({
      next: res => {
        this.pwdLoading.set(false);
        if (res.ok) {
          this.pwdSection.set(false);
          this.pwdCurrent = ''; this.pwdNew = ''; this.pwdConfirm = '';
          this.pwdOk.set('Contraseña actualizada correctamente.');
          setTimeout(() => this.pwdOk.set(''), 3000);
        } else {
          this.pwdError.set((res as any).error ?? 'Error al cambiar la contraseña.');
        }
      },
      error: (err) => {
        this.pwdLoading.set(false);
        this.pwdError.set((err?.error?.error as string) ?? 'Contraseña actual incorrecta.');
      },
    });
  }

  // ── Reorden rápido (M5-3) ─────────────────────────────────────────────────
  reorderLoading = signal<string | null>(null);
  reorderOk      = signal('');

  reorderQuote(q: ApiQuote): void {
    if (this.reorderLoading()) return;
    this.reorderLoading.set(q._id);
    this.api.get<ApiResponse<ApiQuote>>(`${API_CONFIG.endpoints.quotes}/${q._id}`).subscribe({
      next: res => {
        const items = res.data?.items;
        if (!items?.length) { this.reorderLoading.set(null); return; }
        this.qs.clear();
        for (const item of items) {
          const card: ProductCardData = {
            id: item.productId, name: item.name, sku: '',
            category: '', categorySlug: '',
            price: this.formatCLP(item.price), priceRaw: item.price,
            shortStatus: '', stockLabel: '', tags: [],
          };
          this.qs.add(card);
          if (item.quantity > 1) this.qs.updateQty(item.productId, item.quantity);
        }
        this.reorderLoading.set(null);
        this.reorderOk.set('Productos cargados en tu cotización.');
        setTimeout(() => this.reorderOk.set(''), 3000);
        void this.router.navigate(['/quote']);
      },
      error: () => this.reorderLoading.set(null),
    });
  }

  // ── Reseña post-compra (M5-8) ─────────────────────────────────────────────
  reviewProductId   = signal<string | null>(null);
  reviewProductName = '';
  reviewRating      = 0;
  reviewBody        = '';
  reviewLoading     = signal(false);
  reviewError       = signal('');
  reviewOk          = signal('');

  startReview(productId: string, name: string): void {
    this.reviewProductId.set(productId);
    this.reviewProductName = name;
    this.reviewRating = 0;
    this.reviewBody   = '';
    this.reviewError.set('');
    this.reviewOk.set('');
  }

  cancelReview(): void { this.reviewProductId.set(null); }

  setRating(r: number): void { this.reviewRating = r; }

  submitReview(): void {
    const pid = this.reviewProductId();
    if (!pid) return;
    if (!this.reviewRating) { this.reviewError.set('Selecciona una calificación del 1 al 5.'); return; }
    if (!this.reviewBody.trim()) { this.reviewError.set('El comentario es requerido.'); return; }
    this.reviewLoading.set(true);
    this.reviewError.set('');
    this.api.post<ApiResponse<{ message: string }>>(
      `${API_CONFIG.endpoints.reviews}/product/${pid}`,
      { rating: this.reviewRating, body: this.reviewBody.trim() },
    ).subscribe({
      next: () => {
        this.reviewLoading.set(false);
        this.reviewOk.set('¡Reseña enviada! Será publicada tras revisión del equipo.');
        this.reviewProductId.set(null);
        setTimeout(() => this.reviewOk.set(''), 4000);
      },
      error: err => {
        this.reviewLoading.set(false);
        this.reviewError.set((err?.error?.error as string) ?? 'Error al enviar la reseña.');
      },
    });
  }

  // ── Carga de historial ─────────────────────────────────────────────────────
  private loadHistorial(): void {
    this.loadQuotes();
    this.loadSales();
    this.favSvc.loadFavoriteIds();
  }

  private loadQuotes(): void {
    this.quotesLoading.set(true);
    this.quotesError.set('');
    this.api.get<ApiResponse<ApiQuote[]>>(API_CONFIG.endpoints.quotes, { mine: 'true' }).subscribe({
      next: res => { this.quotes.set(res.data ?? []); this.quotesLoading.set(false); },
      error: () => { this.quotesError.set('Error al cargar cotizaciones.'); this.quotesLoading.set(false); },
    });
  }

  private loadSales(): void {
    this.salesLoading.set(true);
    this.salesError.set('');
    this.api.get<ApiResponse<ApiSale[]>>(API_CONFIG.endpoints.sales).subscribe({
      next: res => { this.sales.set(res.data ?? []); this.salesLoading.set(false); },
      error: () => { this.salesError.set('Error al cargar ventas.'); this.salesLoading.set(false); },
    });
  }

  private loadFavorites(): void {
    this.favLoading.set(true);
    this.favSvc.loadFavoriteIds();
    this.catalog.getProducts({ limit: 200 }).subscribe({
      next: res => {
        this.allProducts.set((res.data ?? []).map(p => mapToProductCard(p)));
        this.favLoading.set(false);
      },
      error: () => this.favLoading.set(false),
    });
  }

  // ── Utils ──────────────────────────────────────────────────────────────────
  formatCLP(v: number | undefined): string {
    if (v == null) return '$0';
    return new Intl.NumberFormat('es-CL', {
      style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
    }).format(v);
  }

  formatDate(iso: string | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-CL', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  quoteStatusLabel(s: string | undefined): string {
    const map: Record<string, string> = {
      draft: 'Borrador', sent: 'Enviada', accepted: 'Aceptada',
      rejected: 'Rechazada', expired: 'Vencida',
    };
    return map[s ?? ''] ?? '—';
  }

  quoteStatusCls(s: string | undefined): string {
    if (s === 'accepted') return 'badge--ok';
    if (s === 'rejected' || s === 'expired') return 'badge--err';
    if (s === 'sent') return 'badge--warn';
    return 'badge--def';
  }

  saleStatusLabel(s: string | undefined): string {
    return ({ pending: 'Pendiente', paid: 'Pagada', cancelled: 'Anulada' } as Record<string, string>)[s ?? ''] ?? '—';
  }

  saleStatusCls(s: string | undefined): string {
    if (s === 'paid') return 'badge--ok';
    if (s === 'cancelled') return 'badge--err';
    return 'badge--warn';
  }

  initials(): string {
    return (this.auth.user()?.name ?? '')
      .split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) || '?';
  }

  removeFavorite(productId: string): void {
    this.favSvc.toggle(productId).subscribe({
      next: () => this.allProducts.update(l => l.filter(p => p.id !== productId)),
    });
  }

  goToCatalog(): void { void this.router.navigate(['/catalog']); }
}
