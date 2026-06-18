import { Injectable, inject } from '@angular/core';
import { Observable, delay, map, of } from 'rxjs';
import { ApiService } from './api.service';
import { API_CONFIG } from '../config/api.config';
import { DetectionResult } from '../models/app.models';
import { ApiResponse } from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class MlDetectService {
  private readonly api = inject(ApiService);

  // STUB para escáner en vivo (fuente: cámara) hasta que M4-1 integre YOLO on-device.
  private readonly STUB_LIVE: DetectionResult = {
    detections: [
      {
        label: 'compresor de aire acondicionado',
        partType: 'compressor',
        categorySlug: 'compresores',
        searchTerm: 'compresor',
        confidence: 0.91,
      },
      {
        label: 'filtro de aire HVAC',
        partType: 'filter',
        categorySlug: 'filtros',
        searchTerm: 'filtro',
        confidence: 0.74,
      },
    ],
    source: 'live',
    modelVersion: 'stub-yolo-v0.1',
  };

  readonly CONFIDENCE_THRESHOLD = 0.5;

  detect(imageBase64: string, source: 'live' | 'upload'): Observable<DetectionResult> {
    if (source === 'upload') {
      // CNN real vía backend proxy → GCR (B-ML)
      return this.api
        .post<ApiResponse<DetectionResult>>(
          API_CONFIG.endpoints.mlDetect,
          { image: imageBase64 },
        )
        .pipe(map(res => res.data!));
    }
    // YOLO on-device pendiente (M4-1) — mantiene STUB para captura con cámara
    return of({ ...this.STUB_LIVE, source }).pipe(delay(1200));
  }
}
