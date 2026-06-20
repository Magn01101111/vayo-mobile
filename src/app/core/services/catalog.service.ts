import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';
import { API_CONFIG } from '../config/api.config';
import {
  ApiCategory,
  ApiPaginatedResponse,
  ApiProductDetail,
  ApiProductListItem,
  ApiResponse,
} from '../models/api.models';

export interface ProductsParams {
  q?: string;
  category?: string;
  page?: number;
  limit?: number;
  featured?: boolean;
  onOffer?: boolean;
}

interface RawPaginatedProducts<T> {
  ok: boolean;
  data: T[] | {
    products?: T[];
    total?: number;
    page?: number;
    limit?: number;
    pageSize?: number;
    pages?: number;
  };
  total?: number;
  page?: number;
  pageSize?: number;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly api = inject(ApiService);

  getProducts(params?: ProductsParams): Observable<ApiPaginatedResponse<ApiProductListItem>> {
    return this.api.get<RawPaginatedProducts<ApiProductListItem>>(
      API_CONFIG.endpoints.products,
      params as Record<string, string | number | boolean | undefined | null>,
    ).pipe(
      map(res => this.normalizeProductsResponse(res)),
    );
  }

  getProductById(id: string): Observable<ApiResponse<ApiProductDetail>> {
    return this.api.get<ApiResponse<ApiProductDetail>>(`${API_CONFIG.endpoints.products}/${id}`);
  }

  getCategories(): Observable<ApiResponse<ApiCategory[]>> {
    return this.api.get<ApiResponse<ApiCategory[]>>(API_CONFIG.endpoints.categories);
  }

  getFeaturedProducts(): Observable<ApiPaginatedResponse<ApiProductListItem>> {
    return this.getProducts({ featured: true, limit: 8 });
  }

  getOffers(): Observable<ApiPaginatedResponse<ApiProductListItem>> {
    return this.getProducts({ onOffer: true, limit: 8 });
  }

  private normalizeProductsResponse(
    res: RawPaginatedProducts<ApiProductListItem>,
  ): ApiPaginatedResponse<ApiProductListItem> {
    if (Array.isArray(res.data)) {
      return {
        ok: res.ok,
        data: res.data,
        total: res.total ?? res.data.length,
        page: res.page ?? 1,
        pageSize: res.pageSize ?? res.data.length,
        message: res.message,
      };
    }

    const products = res.data?.products ?? [];
    const total = res.data?.total ?? res.total ?? products.length;
    const page = res.data?.page ?? res.page ?? 1;
    const pageSize = res.data?.limit ?? res.data?.pageSize ?? res.pageSize ?? products.length;

    return {
      ok: res.ok,
      data: products,
      total,
      page,
      pageSize,
      message: res.message,
    };
  }
}
