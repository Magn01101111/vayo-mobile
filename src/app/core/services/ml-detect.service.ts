import { Injectable, inject } from '@angular/core';
import { Observable, from, map } from 'rxjs';
import { MlInferenceService } from './ml-inference.service';
import { DetectionResult, ScannerDetection } from '../models/app.models';

/**
 * Metadatos estaticos por SKU: que partType, categorySlug y searchTerm usar en el catalogo.
 * Cuando se agreguen mas productos, sumar una entrada por SKU aqui.
 */
const SKU_META: Record<string, Pick<ScannerDetection, 'partType' | 'categorySlug' | 'searchTerm'>> = {
  'CTRL-ETG-4AMF25': {
    partType: 'controller',
    categorySlug: 'controladores',
    searchTerm: 'CTRL-ETG-4AMF25',
  },
};

@Injectable({ providedIn: 'root' })
export class MlDetectService {
  private readonly mlInference = inject(MlInferenceService);

  readonly CONFIDENCE_THRESHOLD = 0.5;

  warmup(): void {
    this.mlInference.warmup();
  }

  detect(imageBase64: string, source: 'live' | 'upload'): Observable<DetectionResult> {
    // En localhost y en la app sin backend ML, ambos flujos usan el ONNX local.
    return from(this.mlInference.predict(imageBase64)).pipe(
      map(result => this.toDetectionResult(result, source)),
    );
  }

  private toDetectionResult(
    result: {
      label: string;
      confidence: number;
      rejected: boolean;
      rejectReason?: 'negative_class' | 'low_confidence';
    },
    source: 'live' | 'upload',
  ): DetectionResult {
    if (result.rejected) {
      return {
        detections: [],
        source,
        modelVersion: 'onnx-efficientnetv2s-v1',
        topPrediction: {
          label: result.label,
          confidence: result.confidence,
          rejected: true,
          rejectReason: result.rejectReason,
        },
      };
    }

    const meta = SKU_META[result.label];
    const detection: ScannerDetection = {
      label: result.label,
      confidence: result.confidence,
      partType: meta?.partType ?? 'unknown',
      categorySlug: meta?.categorySlug,
      searchTerm: meta?.searchTerm ?? result.label,
    };

    return {
      detections: [detection],
      source,
      modelVersion: 'onnx-efficientnetv2s-v1',
      topPrediction: {
        label: result.label,
        confidence: result.confidence,
        rejected: false,
      },
    };
  }
}
