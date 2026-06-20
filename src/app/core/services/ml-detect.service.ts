import { Injectable, inject } from '@angular/core';
import { Observable, from, map } from 'rxjs';
import { ApiService } from './api.service';
import { MlInferenceService } from './ml-inference.service';
import { API_CONFIG } from '../config/api.config';
import { DetectionResult, ScannerDetection } from '../models/app.models';
import { ApiResponse } from '../models/api.models';

/**
 * Metadatos estáticos por SKU: qué partType, categorySlug y searchTerm usar en el catálogo.
 * Cuando se agreguen más productos, sumar una entrada por SKU aquí.
 */
const SKU_META: Record<string, Pick<ScannerDetection, 'partType' | 'categorySlug' | 'searchTerm'>> = {
  'CTRL-ETG-4AMF25': {
    partType:     'controller',
    categorySlug: 'controladores',
    searchTerm:   'CTRL-ETG-4AMF25',  // búsqueda exacta por SKU en el catálogo VAYO
  },
};

@Injectable({ providedIn: 'root' })
export class MlDetectService {
  private readonly api         = inject(ApiService);
  private readonly mlInference = inject(MlInferenceService);

  readonly CONFIDENCE_THRESHOLD = 0.5;

  // Delega warmup al servicio de inferencia (llamar al abrir el escáner).
  warmup(): void {
    this.mlInference.warmup();
  }

  detect(imageBase64: string, source: 'live' | 'upload'): Observable<DetectionResult> {
    if (source === 'upload') {
      // Modo galería: CNN real vía backend proxy → GCR (B-ML)
      return this.api
        .post<ApiResponse<DetectionResult>>(
          API_CONFIG.endpoints.mlDetect,
          { image: imageBase64 },
        )
        .pipe(map(res => res.data!));
    }

    // Modo cámara: inferencia ONNX on-device con EfficientNetV2-S (reemplaza STUB M4-1)
    return from(this.mlInference.predict(imageBase64)).pipe(
      map(result => this.toDetectionResult(result, source)),
    );
  }

  private toDetectionResult(
    result: { label: string; confidence: number; rejected: boolean },
    source: 'live' | 'upload',
  ): DetectionResult {
    if (result.rejected) {
      // Confianza insuficiente o clase negativa → sin detecciones
      return { detections: [], source, modelVersion: 'onnx-efficientnetv2s-v1' };
    }

    const meta = SKU_META[result.label];
    const detection: ScannerDetection = {
      label:        result.label,
      confidence:   result.confidence,
      partType:     meta?.partType     ?? 'unknown',
      categorySlug: meta?.categorySlug,
      searchTerm:   meta?.searchTerm   ?? result.label,
    };

    return {
      detections:   [detection],
      source,
      modelVersion: 'onnx-efficientnetv2s-v1',
    };
  }
}
