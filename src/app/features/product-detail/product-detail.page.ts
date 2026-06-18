import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonBackButton,
  IonButtons, IonSegment, IonSegmentButton, IonLabel, IonSpinner, IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { heartOutline, heartSharp, shareOutline } from 'ionicons/icons';
import { Share } from '@capacitor/share';
import { CatalogService } from '../../core/services/catalog.service';
import { QuoteService } from '../../core/services/quote.service';
import { FavoriteService } from '../../core/services/favorite.service';
import { ProductDetailData } from '../../core/models/ui.models';
import { mapToProductDetail } from '../../core/utils/product.mapper';

type DetailTab = 'specs' | 'dims' | 'compat' | 'docs' | 'suppliers';

@Component({
  selector: 'app-product-detail',
  templateUrl: 'product-detail.page.html',
  styleUrls: ['product-detail.page.scss'],
  imports: [
    IonContent, IonHeader, IonToolbar, IonTitle,
    IonBackButton, IonButtons, IonSegment, IonSegmentButton, IonLabel, IonSpinner, IonIcon,
  ],
})
export class ProductDetailPage implements OnInit {
  private readonly route   = inject(ActivatedRoute);
  private readonly catalog = inject(CatalogService);
  private readonly favSvc  = inject(FavoriteService);
  readonly qs = inject(QuoteService);

  readonly product   = signal<ProductDetailData | null>(null);
  readonly loading   = signal(true);
  readonly error     = signal('');
  readonly activeTab = signal<DetailTab>('specs');
  readonly added     = signal(false);

  readonly inCart = computed(() => {
    const p = this.product();
    return p ? this.qs.isInCart(p.id) : false;
  });

  readonly isFav = computed(() => this.favSvc.isFavorite(this.product()?.id ?? ''));

  readonly hasDims = computed(() => {
    const d = this.product()?.dimensions;
    return d && Object.values(d).some(v => v != null);
  });

  readonly shareLoading = signal(false);

  constructor() {
    addIcons({ heartOutline, heartSharp, shareOutline });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.favSvc.loadFavoriteIds();
    this.catalog.getProductById(id).subscribe({
      next: res => {
        this.product.set(mapToProductDetail(res.data));
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No fue posible cargar el producto.');
        this.loading.set(false);
      },
    });
  }

  async shareProduct(): Promise<void> {
    const p = this.product();
    if (!p) return;
    this.shareLoading.set(true);
    try {
      await Share.share({
        title: p.name,
        text: `${p.name} (SKU: ${p.sku}) — VAYO Repuestos Industriales`,
        url: `https://vayo.cl/producto/${p.id}`,
        dialogTitle: 'Compartir producto',
      });
    } catch { /* usuario canceló */ }
    this.shareLoading.set(false);
  }

  toggleFav(): void {
    const id = this.product()?.id;
    if (!id) return;
    this.favSvc.toggle(id).subscribe();
  }

  onTabChange(ev: CustomEvent): void {
    this.activeTab.set(ev.detail.value as DetailTab);
  }

  addToQuote(): void {
    const p = this.product();
    if (!p) return;
    this.qs.add(p);
    this.added.set(true);
    setTimeout(() => this.added.set(false), 1500);
  }

  formatDate(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  }

  speedLabel(speed: 'fast' | 'mid' | 'slow'): string {
    return { fast: 'Rápido', mid: 'Normal', slow: 'Lento' }[speed];
  }

  speedClass(speed: 'fast' | 'mid' | 'slow'): string {
    return { fast: 'speed--fast', mid: 'speed--mid', slow: 'speed--slow' }[speed];
  }
}
