import { Injectable, effect, inject } from '@angular/core';
import { debounceTime, Subject } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { QuoteService } from './quote.service';
import { API_CONFIG } from '../config/api.config';
import { ApiResponse } from '../models/api.models';
import { ProductCardData } from '../models/ui.models';

interface CartItem {
  productId: string; name: string; sku: string;
  price: string; priceRaw: number | null; offerPriceRaw: number | null;
  imageUrl: string | null; qty: number;
}

@Injectable({ providedIn: 'root' })
export class CartSyncService {
  private readonly api  = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly qs   = inject(QuoteService);

  private readonly _save$ = new Subject<void>();

  constructor() {
    // El constructor de un @Injectable ES un contexto de inyección, por lo que effect()
    // puede usarse aquí. Llamarlo desde ngOnInit (contexto de ciclo de vida del componente)
    // no es válido y lanza NG0203.
    this._save$.pipe(debounceTime(2000)).subscribe(() => this.persist());

    effect(() => {
      const loggedIn = this.auth.isLoggedIn();
      if (loggedIn) {
        this.load();
      }
    });

    effect(() => {
      this.qs.items(); // track
      if (this.auth.isLoggedIn()) {
        this._save$.next();
      }
    });
  }

  // Mantenido por compatibilidad con app.component.ts (ahora no-op: todo está en el constructor).
  init(): void {}

  private load(): void {
    this.api.get<ApiResponse<{ items: CartItem[] }>>(API_CONFIG.endpoints.cart).subscribe({
      next: res => {
        const remoteItems = res.data?.items ?? [];
        // Only hydrate if local cart is empty (don't overwrite in-progress cart)
        if (remoteItems.length > 0 && this.qs.items().length === 0) {
          for (const item of remoteItems) {
            const card: ProductCardData = {
              id: item.productId, name: item.name, sku: item.sku ?? '',
              category: '', categorySlug: '',
              price: item.price ?? '', priceRaw: item.priceRaw ?? null,
              offerPriceRaw: item.offerPriceRaw ?? null,
              imageUrl: item.imageUrl ?? undefined,
              shortStatus: '', stockLabel: '', tags: [],
            };
            this.qs.add(card);
            if (item.qty > 1) this.qs.updateQty(item.productId, item.qty);
          }
        }
      },
    });
  }

  private persist(): void {
    if (!this.auth.isLoggedIn()) return;
    const items = this.qs.items().map(i => ({
      productId: i.id, name: i.name, sku: i.sku,
      price: i.price, priceRaw: i.priceRaw ?? null,
      offerPriceRaw: i.offerPriceRaw ?? null,
      imageUrl: i.imageUrl ?? null, qty: i.qty,
    }));
    this.api.put<ApiResponse<unknown>>(API_CONFIG.endpoints.cart, { items }).subscribe();
  }
}
