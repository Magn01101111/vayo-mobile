/**
 * ml-inference.service.ts — inferencia ONNX on-device con onnxruntime-web (WebAssembly).
 *
 * Flujo:
 *  1. warmup()  → descarga el modelo al iniciar la página del escáner (opcional pero recomendado)
 *  2. predict() → DataUrl de la foto → tensor CHW normalizado → logits → softmax → label + conf.
 *
 * Los archivos del modelo viven en assets/ml/ (ver angular.json y ia_related/outputs/).
 * Los .wasm y .mjs de onnxruntime-web se sirven desde assets/ml/wasm/.
 */
import { Injectable } from '@angular/core';
import * as ort from 'onnxruntime-web';

interface InferenceMeta {
  input_size: number;
  normalize_mean: [number, number, number];
  normalize_std:  [number, number, number];
  confidence_threshold: number;
  negative_class: string;
  classes: string[];
}

export interface OnnxPrediction {
  label: string;       // SKU ganador (o negative_class si fue rechazado)
  confidence: number;  // probabilidad del ganador [0-1]
  rejected: boolean;   // true → no supera umbral o es clase negativa
}

@Injectable({ providedIn: 'root' })
export class MlInferenceService {
  private session:     ort.InferenceSession | null = null;
  private meta:        InferenceMeta        | null = null;
  private loadPromise: Promise<void>        | null = null;

  // Dispara la carga en segundo plano sin bloquear (llamar al abrir el escáner).
  warmup(): void {
    if (!this.loadPromise) this.loadPromise = this.loadModel();
  }

  async predict(imageDataUrl: string): Promise<OnnxPrediction> {
    await this.ensureLoaded();
    const tensor  = await this.preprocess(imageDataUrl);
    const feeds   = { [this.session!.inputNames[0]]: tensor };
    const results = await this.session!.run(feeds);
    const logits  = results[this.session!.outputNames[0]].data as Float32Array;
    return this.postprocess(logits);
  }

  private ensureLoaded(): Promise<void> {
    if (this.session) return Promise.resolve();
    if (!this.loadPromise) this.loadPromise = this.loadModel();
    return this.loadPromise;
  }

  private async loadModel(): Promise<void> {
    // Ruta donde están los .wasm y .mjs de onnxruntime (assets/ml/wasm/, ver angular.json).
    ort.env.wasm.wasmPaths = 'assets/ml/wasm/';
    // numThreads = 1 → evita dependencia de SharedArrayBuffer en el WebView de Capacitor.
    ort.env.wasm.numThreads = 1;

    const [metaRes] = await Promise.all([
      fetch('assets/ml/inference_meta.json'),
      fetch('assets/ml/labels.json'),  // precalentamiento de caché; los labels vienen en meta
    ]);

    if (!metaRes.ok) {
      throw new Error(
        '[MlInference] No se encontraron los metadatos del modelo. ' +
        'Corre export_onnx.py y reconstruye la app.'
      );
    }

    this.meta = await metaRes.json() as InferenceMeta;

    // Crea la sesión ONNX. InferenceSession.create() acepta una URL; el runtime la descarga.
    this.session = await ort.InferenceSession.create('assets/ml/model.onnx', {
      executionProviders: ['wasm'],
    });
  }

  /** Redimensiona la imagen a SxS, normaliza con mean/std ImageNet y devuelve tensor CHW. */
  private async preprocess(dataUrl: string): Promise<ort.Tensor> {
    const { input_size: S, normalize_mean: mean, normalize_std: std } = this.meta!;

    const canvas = document.createElement('canvas');
    canvas.width  = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d')!;

    const img = await this.loadImage(dataUrl);
    ctx.drawImage(img, 0, 0, S, S);

    const { data } = ctx.getImageData(0, 0, S, S);  // RGBA uint8 (4 bytes por píxel)

    // El modelo espera [1, 3, S, S] float32 en orden CHW.
    const N       = S * S;
    const float32 = new Float32Array(3 * N);
    for (let i = 0; i < N; i++) {
      float32[i]         = (data[i * 4]     / 255 - mean[0]) / std[0];  // canal R
      float32[N + i]     = (data[i * 4 + 1] / 255 - mean[1]) / std[1];  // canal G
      float32[2 * N + i] = (data[i * 4 + 2] / 255 - mean[2]) / std[2];  // canal B
    }

    return new ort.Tensor('float32', float32, [1, 3, S, S]);
  }

  /** Aplica softmax a los logits y evalúa la clase ganadora contra el umbral. */
  private postprocess(logits: Float32Array): OnnxPrediction {
    const { confidence_threshold, negative_class, classes } = this.meta!;

    const probs = this.softmax(logits);

    // Clase con mayor probabilidad
    let topIdx = 0;
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > probs[topIdx]) topIdx = i;
    }

    const label      = classes[topIdx];
    const confidence = probs[topIdx];
    // Se rechaza si es la clase negativa ("otros") o no alcanza el umbral de confianza.
    const rejected   = label === negative_class || confidence < confidence_threshold;

    return { label, confidence, rejected };
  }

  private softmax(logits: Float32Array): Float32Array {
    const max  = Math.max(...Array.from(logits));
    const exps = Array.from(logits).map(x => Math.exp(x - max));
    const sum  = exps.reduce((a, b) => a + b, 0);
    return new Float32Array(exps.map(x => x / sum));
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img   = new Image();
      img.onload  = () => resolve(img);
      img.onerror = reject;
      img.src     = src;
    });
  }
}
