import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonIcon, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addCircleOutline, cameraOutline, checkmarkCircle, chevronForwardOutline, closeOutline,
  heartOutline, heartSharp, imagesOutline, refreshOutline, shareOutline,
  swapHorizontalOutline, trophyOutline,
} from 'ionicons/icons';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Share } from '@capacitor/share';
import { catchError, forkJoin, map, of } from 'rxjs';

import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { CatalogService } from '../../core/services/catalog.service';
import { FavoriteService } from '../../core/services/favorite.service';
import { InferenceMode, MlDetectService } from '../../core/services/ml-detect.service';
import { QuoteService } from '../../core/services/quote.service';
import { ApiProductListItem, ApiResponse } from '../../core/models/api.models';
import { DetectionResult, ScannerDetection } from '../../core/models/app.models';
import { API_CONFIG } from '../../core/config/api.config';
import { mapToProductCard } from '../../core/utils/product.mapper';

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
  private readonly ml = inject(MlDetectService);
  private readonly catalog = inject(CatalogService);
  private readonly qs = inject(QuoteService);
  private readonly favSvc = inject(FavoriteService);
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly hasWebInference = this.ml.hasWebInference;

  readonly SCAN_REWARD_THRESHOLD = SCAN_REWARD_THRESHOLD;

  readonly state = signal<ScannerState>('idle');
  readonly capturedImage = signal<string | null>(null);
  readonly candidateGroups = signal<CandidateGroup[]>([]);
  readonly analysisResult = signal<DetectionResult | null>(null);
  readonly scanError = signal('');
  readonly inferenceMode = signal<InferenceMode>('local');
  readonly addedIds = signal<Set<string>>(new Set());
  readonly shareLoading = signal<string | null>(null);

  readonly compareList = signal<ApiProductListItem[]>([]);
  readonly compareCount = computed(() => this.compareList().length);
  readonly compareRows = computed<Array<{ label: string; values: string[] }>>(() => [
    { label: 'SKU', values: this.compareList().map(p => p.sku) },
    { label: 'Marca', values: this.compareList().map(p => p.brand) },
    { label: 'Modelo', values: this.compareList().map(p => p.model ?? '-') },
    {
      label: 'Precio',
      values: this.compareList().map(p =>
        p.offerPrice != null ? this.formatCLP(p.offerPrice) : this.formatCLP(p.price)),
    },
    { label: 'Stock', values: this.compareList().map(p => `${p.stock} uds.`) },
    { label: 'Estado', values: this.compareList().map(p => this.stockLabel(p)) },
  ]);

  readonly scanCount = signal(0);
  readonly rewardCode = signal('');
  readonly rewardLoading = signal(false);
  readonly rewardError = signal('');
  readonly scanProgress = computed(() => Math.min(this.scanCount() / SCAN_REWARD_THRESHOLD, 1));
  readonly rewardReady = computed(() => this.scanCount() >= SCAN_REWARD_THRESHOLD && !this.rewardCode());

  readonly hasResults = computed(() =>
    this.candidateGroups().some(g => g.products.length > 0));
  readonly hasModelDetection = computed(() =>
    (this.analysisResult()?.detections.length ?? 0) > 0);
  readonly topPrediction = computed(() => this.analysisResult()?.topPrediction ?? null);
  readonly modeLabel = computed(() =>
    this.inferenceMode() === 'local' ? 'Inferencia local (ONNX en la app)' : 'Inferencia web (Cloud Run)');
  readonly recognizedButMissingInCatalog = computed(() =>
    this.hasModelDetection() && !this.hasResults());
  readonly emptyStateTitle = computed(() => {
    if (this.recognizedButMissingInCatalog()) return 'Reconocido por el modelo, sin producto en catalogo';
    if (this.topPrediction()?.rejected) return 'El modelo no pudo confirmar el producto';
    return 'Sin coincidencias';
  });
  readonly emptyStateMessage = computed(() => {
    const top = this.topPrediction();
    if (this.recognizedButMissingInCatalog() && top) {
      return `La imagen fue reconocida como ${top.label} (${this.pct(top.confidence)}), pero la busqueda en el catalogo no devolvio productos. Revisa si ese SKU existe y esta activo.`;
    }
    if (top?.rejected && top.rejectReason === 'low_confidence') {
      return `El modelo considero como mejor opcion ${top.label} (${this.pct(top.confidence)}), pero no supero el umbral de confianza requerido.`;
    }
    if (top?.rejected && top.rejectReason === 'negative_class') {
      return 'El modelo clasifico la imagen como "otros", asi que no la asocio a un repuesto conocido.';
    }
    return 'No se encontraron productos relacionados. Intenta con otra foto o busca manualmente en el catalogo.';
  });

  constructor() {
    addIcons({
      cameraOutline,
      imagesOutline,
      shareOutline,
      heartOutline,
      heartSharp,
      addCircleOutline,
      checkmarkCircle,
      refreshOutline,
      chevronForwardOutline,
      swapHorizontalOutline,
      closeOutline,
      trophyOutline,
    });
    this.ml.warmup('local');
  }

  async capture(source: 'camera' | 'gallery'): Promise<void> {
    this.scanError.set('');
    console.info('[Scanner] Captura solicitada.', {
      source,
      inferenceMode: this.inferenceMode(),
    });

    try {
      const photo = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      });

      if (!photo.dataUrl) {
        this.scanError.set('No se recibio imagen.');
        return;
      }

      this.capturedImage.set(photo.dataUrl);
      this.scan(photo.dataUrl, source === 'camera' ? 'live' : 'upload');
    } catch (error) {
      console.error('[Scanner] Error capturando imagen:', error);
      this.scanError.set(
        source === 'camera'
          ? 'No se pudo abrir la camara en web. Revisa permisos del navegador e intenta de nuevo.'
          : 'No se pudo abrir el selector de imagenes.',
      );
    }
  }

  private scan(imageDataUrl: string, source: 'live' | 'upload'): void {
    const mode = this.inferenceMode();
    this.state.set('scanning');
    this.candidateGroups.set([]);
    this.analysisResult.set(null);

    console.info('[Scanner] Iniciando analisis.', { source, inferenceMode: mode });
    this.ml.detect(imageDataUrl, source, mode).subscribe({
      next: result => {
        this.analysisResult.set(result);
        console.info('[Scanner] Resultado del modelo:', {
          inferenceMode: mode,
          modelVersion: result.modelVersion,
          detections: result.detections,
          topPrediction: result.topPrediction,
        });
        const above = result.detections.slice(0, 3);

        if (above.length === 0) {
          console.info('[Scanner] El modelo no entrego detecciones utilizables.', {
            topPrediction: result.topPrediction,
          });
          this.candidateGroups.set([]);
          this.state.set('results');
          return;
        }

        forkJoin(
          above.map(d =>
            this.catalog.getProducts({ q: d.searchTerm, limit: 5 }).pipe(
              map(res => {
                const products = res.data ?? [];
                console.info('[Scanner] Resultado de catalogo:', {
                  searchTerm: d.searchTerm,
                  count: products.length,
                  products: products.map(product => ({ id: product.id, sku: product.sku, name: product.name })),
                });
                return ({ detection: d, products } as CandidateGroup);
              }),
              catchError(() => of({ detection: d, products: [] } as CandidateGroup)),
            )),
        ).subscribe({
          next: groups => {
            this.candidateGroups.set(groups);
            this.state.set('results');
            if (groups.some(g => g.products.length > 0)) {
              this.scanCount.update(n => n + 1);
            }
          },
          error: error => {
            console.error('[Scanner] Error resolviendo candidatos:', error);
            this.candidateGroups.set([]);
            this.state.set('results');
          },
        });
      },
      error: error => {
        console.error('[Scanner] Error durante el analisis:', error);
        const detail = error instanceof Error ? error.message : '';
        this.scanError.set(
          detail ? `Error al analizar la imagen. ${detail}` : 'Error al analizar la imagen.',
        );
        this.state.set('idle');
      },
    });
  }

  setInferenceMode(mode: InferenceMode): void {
    this.inferenceMode.set(mode);
    this.scanError.set('');
    console.info('[Scanner] Modo de inferencia actualizado.', {
      mode,
      hasWebInference: this.hasWebInference,
    });
    this.ml.warmup(mode);
  }

  reset(): void {
    this.state.set('idle');
    this.capturedImage.set(null);
    this.candidateGroups.set([]);
    this.analysisResult.set(null);
    this.scanError.set('');
    this.addedIds.set(new Set());
    this.compareList.set([]);
  }

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

  isAdded(productId: string): boolean {
    return this.addedIds().has(productId);
  }

  toggleFavorite(productId: string): void {
    this.favSvc.toggle(productId).subscribe();
  }

  isFavorite(productId: string): boolean {
    return this.favSvc.isFavorite(productId);
  }

  openDetail(productId: string): void {
    void this.router.navigate(['/catalog', productId]);
  }

  async shareProduct(product: ApiProductListItem): Promise<void> {
    this.shareLoading.set(product.id);
    try {
      await Share.share({
        title: product.name,
        text: `${product.name} (SKU: ${product.sku}) - VAYO Repuestos Industriales`,
        dialogTitle: 'Compartir producto',
      });
    } catch {
      // Usuario cancelo o la plataforma no lo soporta.
    }
    this.shareLoading.set(null);
  }

  toggleCompare(product: ApiProductListItem): void {
    const list = this.compareList();
    const idx = list.findIndex(p => p.id === product.id);
    if (idx >= 0) {
      this.compareList.set(list.filter((_, i) => i !== idx));
    } else if (list.length < 3) {
      this.compareList.set([...list, product]);
    }
  }

  isInCompare(productId: string): boolean {
    return this.compareList().some(p => p.id === productId);
  }

  openCompare(): void {
    this.state.set('compare');
  }

  closeCompare(): void {
    this.state.set('results');
  }

  clearCompare(): void {
    this.compareList.set([]);
  }

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

  formatCLP(value: number | null): string {
    if (value == null) return 'Consultar';
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(value);
  }

  pct(confidence: number): string {
    return `${Math.round(confidence * 100)}%`;
  }

  imgUrl(product: ApiProductListItem): string | null {
    return product.images?.[0]?.url ?? product.imageUrl ?? null;
  }

  stockLabel(product: ApiProductListItem): string {
    if (product.availabilityStatus === 'in_stock') return 'Disponible';
    if (product.availabilityStatus === 'out_of_stock') return 'Sin stock';
    if (product.availabilityStatus === 'on_request') return 'Bajo pedido';
    if (product.availabilityStatus === 'discontinued') return 'Discontinuado';
    return 'Consultar';
  }
}
