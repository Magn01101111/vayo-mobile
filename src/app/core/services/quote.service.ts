import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, tap, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { API_CONFIG } from '../config/api.config';
import { Coupon, QuotationItem } from '../models/app.models';
import { ApiResponse } from '../models/api.models';
import { ProductCardData } from '../models/ui.models';

export interface QuoteSubmitClient {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  notes?: string;
  customerType?: 'person' | 'company';
}

export interface QuoteSubmitResult {
  id: string;
  folio?: string;
}

@Injectable({ providedIn: 'root' })
export class QuoteService {
  private readonly api = inject(ApiService);

  private readonly _items      = signal<QuotationItem[]>([]);
  private readonly _coupon     = signal<Coupon | null>(null);
  private readonly _submitting = signal(false);

  readonly items      = this._items.asReadonly();
  readonly coupon     = this._coupon.asReadonly();
  readonly submitting = this._submitting.asReadonly();

  readonly itemCount = computed(() =>
    this._items().reduce((s, i) => s + i.qty, 0),
  );

  readonly subtotal = computed(() =>
    this._items().reduce((s, i) => {
      const unit = this.itemUnitPrice(i);
      return s + unit * i.qty;
    }, 0),
  );

  readonly discount = computed(() => {
    const c = this._coupon();
    if (!c) return 0;
    const sub = this.subtotal();
    return c.type === 'percentage'
      ? Math.floor(sub * c.value / 100)
      : Math.min(c.value, sub);
  });

  readonly total = computed(() => Math.max(0, this.subtotal() - this.discount()));

  itemUnitPrice(item: Pick<ProductCardData, 'priceRaw' | 'offerPriceRaw'>): number {
    return item.offerPriceRaw ?? item.priceRaw ?? 0;
  }

  add(product: ProductCardData): void {
    if (product.isPurchasable === false) return;
    this._items.update(items => {
      const idx = items.findIndex(i => i.id === product.id);
      if (idx >= 0) {
        return items.map((i, n) => {
          if (n !== idx) return i;
          const maxQty = i.maxQty ?? i.stockRaw;
          const nextQty = i.qty + 1;
          return { ...i, qty: maxQty != null ? Math.min(nextQty, maxQty) : nextQty };
        });
      }
      return [...items, {
        ...product,
        qty: 1,
        maxQty: product.stockRaw ?? undefined,
        addedAt: new Date().toISOString(),
      }];
    });
  }

  remove(productId: string): void {
    this._items.update(items => items.filter(i => i.id !== productId));
  }

  updateQty(productId: string, qty: number): void {
    if (qty <= 0) { this.remove(productId); return; }
    this._items.update(items =>
      items.map(i => {
        if (i.id !== productId) return i;
        const maxQty = i.maxQty ?? i.stockRaw;
        return { ...i, qty: maxQty != null ? Math.min(qty, maxQty) : qty };
      }),
    );
  }

  applyCoupon(code: string): Observable<Coupon> {
    return this.api.post<ApiResponse<{
      code: string; type: string; value: number; description?: string; discount: number;
    }>>(API_CONFIG.endpoints.couponsValidate, { code: code.toUpperCase().trim(), subtotal: this.subtotal() }).pipe(
      map(res => {
        const c: Coupon = {
          code:        res.data.code,
          type:        res.data.type as 'percentage' | 'fixed',
          value:       res.data.value,
          description: res.data.description,
          discount:    res.data.discount,
        };
        this._coupon.set(c);
        return c;
      }),
    );
  }

  removeCoupon(): void {
    this._coupon.set(null);
  }

  submitQuote(client: QuoteSubmitClient): Observable<QuoteSubmitResult> {
    const items = this._items();
    if (items.length === 0) throw new Error('El carrito está vacío');

    const subtotal = this.subtotal();
    const discount = this.discount();
    const total    = this.total();
    const coupon   = this._coupon();

    const payload = {
      client: {
        name:        client.name,
        email:       client.email,
        phone:       client.phone ?? '',
        company:     client.company ?? '',
        notes:       client.notes ?? '',
      },
      items: items.map(i => ({
        productId: i.id,
        name:      i.name,
        sku:       i.sku,
        price:     this.itemUnitPrice(i),
        listPrice: i.priceRaw ?? this.itemUnitPrice(i),
        offerPrice: i.offerPriceRaw ?? null,
        offerApplied: i.offerPriceRaw != null,
        offerDiscountPercent: i.offerDiscountPercent ?? null,
        quantity:  i.qty,
        total:     this.itemUnitPrice(i) * i.qty,
      })),
      totals: { subtotal, discount, iva: 0, total },
      extra: {
        customerType:        client.customerType ?? 'person',
        shippingSameAsBilling: true,
        acceptsTerms:        true,
        ...(coupon ? {
          coupon:   { code: coupon.code, type: coupon.type, value: coupon.value },
          discount,
        } : {}),
      },
    };

    this._submitting.set(true);
    return this.api.post<ApiResponse<QuoteSubmitResult>>(API_CONFIG.endpoints.quotes, payload).pipe(
      map(res => res.data),
      tap(() => { this.clear(); this._submitting.set(false); }),
      catchError(err => { this._submitting.set(false); return throwError(() => err); }),
    );
  }

  clear(): void {
    this._items.set([]);
    this._coupon.set(null);
  }

  isInCart(productId: string): boolean {
    return this._items().some(i => i.id === productId);
  }

  qtyInCart(productId: string): number {
    return this._items().find(i => i.id === productId)?.qty ?? 0;
  }
}
