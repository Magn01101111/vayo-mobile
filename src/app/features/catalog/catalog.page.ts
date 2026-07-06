import {
  Component, OnInit, OnDestroy, inject, signal, computed, effect,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonTitle, IonToolbar,
  IonSearchbar, IonSpinner, IonIcon,
} from '@ionic/angular/standalone';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { addIcons } from 'ionicons';
import { addOutline, cartOutline, checkmarkCircle } from 'ionicons/icons';
import { CatalogService } from '../../core/services/catalog.service';
import { QuoteService } from '../../core/services/quote.service';
import { ApiProductListItem, ApiCategory } from '../../core/models/api.models';
import { mapToProductCard } from '../../core/utils/product.mapper';

@Component({
  selector: 'app-catalog',
  templateUrl: 'catalog.page.html',
  styleUrls: ['catalog.page.scss'],
  imports: [
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonSearchbar, IonSpinner, IonIcon,
  ],
})
export class CatalogPage implements OnInit, OnDestroy {
  private readonly catalogService = inject(CatalogService);
  private readonly router         = inject(Router);
  readonly qs = inject(QuoteService);

  private readonly destroy$ = new Subject<void>();
  private readonly search$  = new Subject<string>();

  readonly products    = signal<ApiProductListItem[]>([]);
  readonly categories  = signal<ApiCategory[]>([]);
  readonly loading     = signal(true);
  readonly error       = signal('');
  readonly total       = signal(0);
  readonly currentPage = signal(1);
  readonly activeSlug  = signal<string | null>(null);
  readonly searchTerm  = signal('');

  readonly limit = 16;

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.limit)));

  readonly pageRange = computed(() => {
    const cur   = this.currentPage();
    const total = this.totalPages();
    const half  = 2;
    const start = Math.max(1, cur - half);
    const end   = Math.min(total, cur + half);
    const pages: number[] = [];
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  });

  constructor() {
    addIcons({ addOutline, cartOutline, checkmarkCircle });
    effect(() => {
      const _ = this.currentPage();
      const __ = this.activeSlug();
      const ___ = this.searchTerm();
    });
  }

  ngOnInit(): void {
    this.loadCategories();
    this.loadProducts();

    this.search$.pipe(
      debounceTime(350),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(term => {
      this.searchTerm.set(term);
      this.currentPage.set(1);
      this.loadProducts();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchChange(ev: CustomEvent): void {
    this.search$.next((ev.detail.value ?? '').trim());
  }

  selectCategory(slug: string | null): void {
    this.activeSlug.set(slug);
    this.currentPage.set(1);
    this.loadProducts();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    this.currentPage.set(page);
    this.loadProducts();
  }

  openDetail(id: string): void {
    void this.router.navigate(['/catalog', id]);
  }

  addToQuote(ev: Event, product: ApiProductListItem): void {
    ev.stopPropagation();
    const card = mapToProductCard(product);
    if (!card.isPurchasable) return;
    this.qs.add(card);
  }

  inCart(id: string): boolean {
    return this.qs.isInCart(id);
  }

  isPurchasable(product: ApiProductListItem): boolean {
    return mapToProductCard(product).isPurchasable !== false;
  }

  discountPct(p: ApiProductListItem): number {
    if (!p.offerPrice || !p.price) return 0;
    return Math.round((1 - p.offerPrice / p.price) * 100);
  }

  formatPrice(price: number | null): string {
    if (price == null) return 'Consultar';
    return new Intl.NumberFormat('es-CL', {
      style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
    }).format(price);
  }

  private loadCategories(): void {
    this.catalogService.getCategories().subscribe({
      next: res => this.categories.set((res.data ?? []).filter(c => c.isActive)),
    });
  }

  private loadProducts(): void {
    this.loading.set(true);
    this.error.set('');
    this.catalogService.getProducts({
      page:     this.currentPage(),
      limit:    this.limit,
      q:        this.searchTerm() || undefined,
      category: this.activeSlug() ?? undefined,
    }).subscribe({
      next: res => {
        this.products.set(res.data);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No fue posible cargar el catálogo.');
        this.loading.set(false);
      },
    });
  }
}
