import { Injectable, inject } from '@angular/core';
import { Observable, from, map, throwError } from 'rxjs';
import { MlInferenceService } from './ml-inference.service';
import { DetectionResult, ScannerDetection } from '../models/app.models';
import { environment } from '../../../environments/environment';

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

export type InferenceMode = 'local' | 'web';

interface BasePrediction {
  label: string;
  confidence: number;
  rejected: boolean;
  rejectReason?: 'negative_class' | 'low_confidence';
}

@Injectable({ providedIn: 'root' })
export class MlDetectService {
  private readonly mlInference = inject(MlInferenceService);
  private readonly webPredictUrl = environment.mlCloudUrl
    ? `${environment.mlCloudUrl.replace(/\/$/, '')}/predict`
    : '';

  readonly CONFIDENCE_THRESHOLD = 0.94;
  readonly hasWebInference = !!this.webPredictUrl;

  warmup(mode: InferenceMode = 'local'): void {
    if (mode === 'local') {
      console.info('[MlDetect] Warmup inferencia local ONNX...');
      this.mlInference.warmup();
      return;
    }

    console.info('[MlDetect] Inferencia web seleccionada; no requiere warmup local.', {
      endpoint: this.webPredictUrl,
    });
  }

  detect(imageBase64: string, source: 'live' | 'upload', mode: InferenceMode = 'local'): Observable<DetectionResult> {
    if (mode === 'web') {
      return this.detectWeb(imageBase64, source);
    }

    console.info('[MlDetect] Ejecutando inferencia local ONNX.', { source });
    return from(this.mlInference.predict(imageBase64)).pipe(
      map(result => this.toLocalDetectionResult(result, source)),
    );
  }

  private detectWeb(imageBase64: string, source: 'live' | 'upload'): Observable<DetectionResult> {
    if (!this.webPredictUrl) {
      return throwError(() => new Error('[MlDetect] No hay URL configurada para inferencia web.'));
    }

    const formData = new FormData();
    formData.append('file', this.dataUrlToBlob(imageBase64), `scanner-${Date.now()}.jpg`);

    console.info('[MlDetect] Ejecutando inferencia web.', {
      source,
      endpoint: this.webPredictUrl,
      payloadLength: imageBase64.length,
    });

    return from(fetch(this.webPredictUrl, {
      method: 'POST',
      body: formData,
    }).then(async response => {
      const rawText = await response.text();
      let payload: Partial<DetectionResult> | { error?: string };

      try {
        payload = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(`[MlDetect] La respuesta web no es JSON valido (${response.status}).`);
      }

      if (!response.ok) {
        const detail = 'error' in payload && payload.error ? payload.error : `HTTP ${response.status}`;
        throw new Error(`[MlDetect] Fallo la inferencia web: ${detail}`);
      }

      console.info('[MlDetect] Respuesta inferencia web recibida.', {
        status: response.status,
        modelVersion: (payload as Partial<DetectionResult>).modelVersion,
        detections: (payload as Partial<DetectionResult>).detections?.length ?? 0,
        topPrediction: (payload as Partial<DetectionResult>).topPrediction,
      });

      return this.normalizeDetectionResult(payload as Partial<DetectionResult>, source, 'cloud-run-pt-v1');
    }));
  }

  private toLocalDetectionResult(
    result: BasePrediction,
    source: 'live' | 'upload',
  ): DetectionResult {
    const detections = result.rejected ? [] : [{
      label: result.label,
      confidence: result.confidence,
      partType: 'unknown',
      searchTerm: result.label,
    } satisfies ScannerDetection];

    return this.normalizeDetectionResult({
      detections,
      source,
      modelVersion: 'onnx-efficientnetv2s-v1',
      topPrediction: {
        label: result.label,
        confidence: result.confidence,
        rejected: result.rejected,
        rejectReason: result.rejectReason,
      },
    }, source, 'onnx-efficientnetv2s-v1');
  }

  private normalizeDetectionResult(
    result: Partial<DetectionResult>,
    source: 'live' | 'upload',
    fallbackVersion: string,
  ): DetectionResult {
    const detections = (result.detections ?? []).map(detection => {
      const meta = SKU_META[detection.label];
      return {
        ...detection,
        partType: detection.partType ?? meta?.partType ?? 'unknown',
        categorySlug: detection.categorySlug ?? meta?.categorySlug,
        searchTerm: detection.searchTerm ?? meta?.searchTerm ?? detection.label,
      };
    });

    return {
      detections,
      source,
      modelVersion: result.modelVersion ?? fallbackVersion,
      topPrediction: result.topPrediction,
    };
  }

  private dataUrlToBlob(dataUrl: string): Blob {
    const [header, base64] = dataUrl.split(',');
    if (!header || !base64) {
      throw new Error('[MlDetect] La imagen no tiene un Data URL valido para la inferencia web.');
    }

    const mimeMatch = header.match(/data:(.*?);base64/);
    const mimeType = mimeMatch?.[1] ?? 'image/jpeg';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }
}
