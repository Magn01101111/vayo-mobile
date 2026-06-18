import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
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

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly api = inject(ApiService);

  getProducts(params?: ProductsParams): Observable<ApiPaginatedResponse<ApiProductListItem>> {
    return this.api.get<ApiPaginatedResponse<ApiProductListItem>>(
      API_CONFIG.endpoints.products,
      params as Record<string, string | number | boolean | undefined | null>,
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
}
