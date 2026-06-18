import { Component, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonTitle, IonToolbar, IonSpinner, IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  cameraOutline, imagesOutline, shareOutline, heartOutline,
  heartSharp, addCircleOutline, checkmarkCircle, refreshOutline,
  chevronForwardOutline, swapHorizontalOutline, closeOutline, trophyOutline,
} from 'ionicons/icons';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Share } from '@capacitor/share';
import { forkJoin, catchError, map, of } from 'rxjs';

import { MlDetectService } from '../../core/services/ml-detect.service';
import { CatalogService } from '../../core/services/catalog.service';
import { QuoteService } from '../../core/services/quote.service';
import { FavoriteService } from '../../core/services/favorite.service';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { ApiProductListItem, ApiResponse } from '../../core/models/api.models';
import { ScannerDetection } from '../../core/models/app.models';
import { mapToProductCard } from '../../core/utils/product.mapper';
import { API_CONFIG } from '../../core/config/api.config';

type ScannerState = 'idle' | 'scanning' | 'results' | 'compare';

interface CandidateGroup {
  detection: ScannerDetection;
  products: ApiProductListItem[];
}

interface RewardClaim {
  code: string;
  value: number;
  description: string;
  expiresAt: string;
}

const SCAN_REWARD_THRESHOLD = 5;

@Component({
  selector: 'app-scanner',
  templateUrl: 'scanner.page.html',
  styleUrls: ['scanner.page.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, IonSpinner, IonIcon],
})
export class ScannerPage {
  private readonly ml      = inject(MlDetectService);
  private readonly catalog = inject(CatalogService);
  private readonly qs      = inject(QuoteService);
  private readonly favSvc  = inject(FavoriteService);
  private readonly api     = inject(ApiService);
  readonly auth            = inject(AuthService);
  private readonly router  = inject(Router);

  readonly SCAN_REWARD_THRESHOLD = SCAN_REWARD_THRESHOLD;

  // ── Estado principal ───────────────────────────────────────────────────
  readonly state           = signal<ScannerState>('idle');
  readonly capturedImage   = signal<string | null>(null);
  readonly candidateGroups = signal<CandidateGroup[]>([]);
  readonly scanError       = signal('');
  readonly addedIds        = signal<Set<string>>(new Set());
  readonly shareLoading    = signal<string | null>(null);

  // ── M5-7 Comparador ───────────────────────────────────────────────────
  readonly compareList  = signal<ApiProductListItem[]>([]);
  readonly compareCount = computed(() => this.compareList().length);
  readonly compareRows  = computed<Array<{ label: string; values: string[] }>>(() => [
    { label: 'SKU',    values: this.compareList().map(p => p.sku) },
    { label: 'Marca',  values: this.compareList().map(p => p.brand) },
    { label: 'Modelo', values: this.compareList().map(p => p.model ?? '—') },
    { label: 'Precio', values: this.compareList().map(p =>
      p.offerPrice != null ? this.formatCLP(p.offerPrice) : this.formatCLP(p.price)
    )},
    { label: 'Stock',  values: this.compareList().map(p => `${p.stock} uds.`) },
    { label: 'Estado', values: this.compareList().map(p => this.stockLabel(p)) },
  ]);

  // ── M5-1 Recompensa de escaneo ─────────────────────────────────────────
  readonly scanCount     = signal(0);
  readonly rewardCode    = signal('');
  readonly rewardLoading = signal(false);
  readonly rewardError   = signal('');
  readonly scanProgress  = computed(() => Math.min(this.scanCount() / SCAN_REWARD_THRESHOLD, 1));
  readonly rewardReady   = computed(() => this.scanCount() >= SCAN_REWARD_THRESHOLD && !this.rewardCode());

  readonly hasResults = computed(() =>
    this.candidateGroups().some(g => g.products.length > 0)
  );

  constructor() {
    addIcons({
      cameraOutline, imagesOutline, shareOutline, heartOutline,
      heartSharp, addCircleOutline, checkmarkCircle, refreshOutline,
      chevronForwardOutline, swapHorizontalOutline, closeOutline, trophyOutline,
    });
  }

  // ── Captura (M3-1) ─────────────────────────────────────────────────────
  async capture(source: 'camera' | 'gallery'): Promise<void> {
    this.scanError.set('');
    try {
      const photo = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      });
      if (!photo.dataUrl) { this.scanError.set('No se recibió imagen.'); return; }
      this.capturedImage.set(photo.dataUrl);
      this.scan(photo.dataUrl, source === 'camera' ? 'live' : 'upload');
    } catch {
      this.scanError.set('No se pudo acceder a la cámara. Verifica los permisos.');
    }
  }

  // ── Detección + resolución a productos (M3-2 + M3-3) ──────────────────
  private scan(imageDataUrl: string, source: 'live' | 'upload'): void {
    this.state.set('scanning');
    this.candidateGroups.set([]);

    this.ml.detect(imageDataUrl, source).subscribe({
      next: result => {
        const above = result.detections
          .filter(d => d.confidence >= this.ml.CONFIDENCE_THRESHOLD)
          .slice(0, 3);

        if (above.length === 0) {
          this.candidateGroups.set([]);
          this.state.set('results');
          return;
        }

        forkJoin(
          above.map(d =>
            this.catalog.getProducts({ q: d.searchTerm, limit: 5 }).pipe(
              map(res => ({ detection: d, products: res.data ?? [] } as CandidateGroup)),
              catchError(() => of({ detection: d, products: [] } as CandidateGroup)),
            )
          )
        ).subscribe({
          next: groups => {
            this.candidateGroups.set(groups);
            this.state.set('results');
            // M5-1: incrementar contador sólo en escaneos con productos encontrados
            if (groups.some(g => g.products.length > 0)) {
              this.scanCount.update(n => n + 1);
            }
          },
          error: () => {
            this.candidateGroups.set([]);
            this.state.set('results');
          },
        });
      },
      error: () => {
        this.scanError.set('Error al analizar la imagen.');
        this.state.set('idle');
      },
    });
  }

  reset(): void {
    this.state.set('idle');
    this.capturedImage.set(null);
    this.candidateGroups.set([]);
    this.scanError.set('');
    this.addedIds.set(new Set());
    this.compareList.set([]);
  }

  // ── Acciones sobre candidatos (M3-4) ────────────────────────────────
  addToQuote(product: ApiProductListItem): void {
    this.qs.add(mapToProductCard(product));
    const ids = new Set(this.addedIds());
    ids.add(product.id);
    this.addedIds.set(ids);
    setTimeout(() => {
      const updated = new Set(this.addedIds());
      updated.delete(product.id);
      this.addedIds.set(updated);
    }, 1500);
  }

  isAdded(productId: string): boolean     { return this.addedIds().has(productId); }
  toggleFavorite(productId: string): void { this.favSvc.toggle(productId).subscribe(); }
  isFavorite(productId: string): boolean  { return this.favSvc.isFavorite(productId); }
  openDetail(productId: string): void     { void this.router.navigate(['/catalog', productId]); }

  async shareProduct(product: ApiProductListItem): Promise<void> {
    this.shareLoading.set(product.id);
    try {
      await Share.share({
        title: product.name,
        text: `${product.name} (SKU: ${product.sku}) — VAYO Repuestos Industriales`,
        dialogTitle: 'Compartir producto',
      });
    } catch { /* usuario canceló o plataforma no soporta */ }
    this.shareLoading.set(null);
  }

  // ── M5-7 Comparador ──────────────────────────────────────────────────
  toggleCompare(product: ApiProductListItem): void {
    const list = this.compareList();
    const idx  = list.findIndex(p => p.id === product.id);
    if (idx >= 0) {
      this.compareList.set(list.filter((_, i) => i !== idx));
    } else if (list.length < 3) {
      this.compareList.set([...list, product]);
    }
  }

  isInCompare(productId: string): boolean { return this.compareList().some(p => p.id === productId); }
  openCompare():  void { this.state.set('compare'); }
  closeCompare(): void { this.state.set('results'); }
  clearCompare(): void { this.compareList.set([]); }

  // ── M5-1 Recompensa ──────────────────────────────────────────────────
  claimReward(): void {
    if (!this.auth.isLoggedIn() || this.rewardLoading()) return;
    this.rewardLoading.set(true);
    this.rewardError.set('');
    this.api.post<ApiResponse<RewardClaim>>(API_CONFIG.endpoints.rewardsClaim, {}).subscribe({
      next: res => {
        this.rewardCode.set(res.data?.code ?? '');
        this.rewardLoading.set(false);
      },
      error: err => {
        this.rewardError.set(err?.error?.message ?? 'No se pudo reclamar la recompensa.');
        this.rewardLoading.set(false);
      },
    });
  }

  // ── Formateo ─────────────────────────────────────────────────────────
  formatCLP(v: number | null): string {
    if (v == null) return 'Consultar';
    return new Intl.NumberFormat('es-CL', {
      style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
    }).format(v);
  }

  pct(c: number): string { return `${Math.round(c * 100)}%`; }

  imgUrl(p: ApiProductListItem): string | null {
    return p.images?.[0]?.url ?? p.imageUrl ?? null;
  }

  stockLabel(p: ApiProductListItem): string {
    if (p.availabilityStatus === 'in_stock')     return 'Disponible';
    if (p.availabilityStatus === 'out_of_stock') return 'Sin stock';
    if (p.availabilityStatus === 'on_request')   return 'Bajo pedido';
    if (p.availabilityStatus === 'discontinued') return 'Discontinuado';
    return 'Consultar';
  }
}
