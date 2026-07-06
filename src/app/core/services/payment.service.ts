import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService } from './api.service';
import { API_CONFIG } from '../config/api.config';
import { ApiResponse } from '../models/api.models';

export interface WebpayInitResponse {
  token: string;
  url: string;
  paymentId: string;
}

export interface WebpayConfirmResponse {
  status: 'paid' | 'rejected';
  folio?: string;
  reason?: string;
}

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly api = inject(ApiService);

  initWebpay(saleId: string): Observable<ApiResponse<WebpayInitResponse>> {
    return this.api.post<ApiResponse<WebpayInitResponse>>(
      API_CONFIG.endpoints.paymentsWebpayInit,
      { saleId },
    );
  }

  confirmWebpay(saleId: string, token: string): Observable<ApiResponse<WebpayConfirmResponse>> {
    return this.api.get<ApiResponse<WebpayConfirmResponse>>(
      `${API_CONFIG.endpoints.paymentsWebpayConfirm}/${saleId}`,
      { token_ws: token },
    );
  }

  redirectToWebpay(url: string, token: string): void {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'token_ws';
    input.value = token;

    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
  }
}
