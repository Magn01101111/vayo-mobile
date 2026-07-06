/**
 * ml-inference.service.ts - inferencia ONNX on-device con onnxruntime-web (WebAssembly).
 *
 * Flujo:
 *  1. warmup()  -> descarga el modelo al iniciar la pagina del escaner.
 *  2. predict() -> DataUrl de la foto -> tensor CHW normalizado -> logits -> softmax.
 */
import { Injectable } from '@angular/core';
import * as ort from 'onnxruntime-web';

interface InferenceMeta {
  input_size: number;
  normalize_mean: [number, number, number];
  normalize_std: [number, number, number];
  confidence_threshold: number;
  negative_class: string;
  classes: string[];
}

export interface OnnxPrediction {
  label: string;
  confidence: number;
  rejected: boolean;
  rejectReason?: 'negative_class' | 'low_confidence';
}

const MIN_CONFIDENCE_THRESHOLD = 0.94;

@Injectable({ providedIn: 'root' })
export class MlInferenceService {
  private session: ort.InferenceSession | null = null;
  private meta: InferenceMeta | null = null;
  private loadPromise: Promise<void> | null = null;

  warmup(): void {
    if (!this.loadPromise) {
      this.loadPromise = this.loadModel().catch(error => {
        console.error('[MlInference] Warmup fallo:', error);
        this.loadPromise = null;
        throw error;
      });
    }
  }

  async predict(imageDataUrl: string): Promise<OnnxPrediction> {
    await this.ensureLoaded();
    const tensor = await this.preprocess(imageDataUrl);
    const feeds = { [this.session!.inputNames[0]]: tensor };
    const results = await this.session!.run(feeds);
    const logits = results[this.session!.outputNames[0]].data as Float32Array;
    return this.postprocess(logits);
  }

  private ensureLoaded(): Promise<void> {
    if (this.session) return Promise.resolve();
    if (!this.loadPromise) this.loadPromise = this.loadModel();
    return this.loadPromise;
  }

  private async loadModel(): Promise<void> {
    ort.env.wasm.wasmPaths = '/assets/ml/wasm/';
    ort.env.wasm.numThreads = 1;

    console.info('[MlInference] Cargando metadatos e inicializando sesion ONNX...');
    const metaRes = await fetch('/assets/ml/inference_meta.json');
    if (!metaRes.ok) {
      throw new Error(
        '[MlInference] No se encontraron los metadatos del modelo. ' +
        'Falta el bundle generado en ia_related/outputs (inference_meta.json/model.onnx). ' +
        'Corre export_onnx.py y reconstruye la app.'
      );
    }

    this.meta = await metaRes.json() as InferenceMeta;
    this.session = await ort.InferenceSession.create('/assets/ml/model.onnx', {
      executionProviders: ['wasm'],
    });

    console.info('[MlInference] Modelo ONNX listo.', {
      inputSize: this.meta.input_size,
      classes: this.meta.classes,
      threshold: Math.max(this.meta.confidence_threshold, MIN_CONFIDENCE_THRESHOLD),
    });
  }

  private async preprocess(dataUrl: string): Promise<ort.Tensor> {
    const { input_size: size, normalize_mean: mean, normalize_std: std } = this.meta!;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('[MlInference] No se pudo crear el contexto 2D para preprocesar la imagen.');
    }

    const img = await this.loadImage(dataUrl);
    if (!img.naturalWidth || !img.naturalHeight) {
      throw new Error('[MlInference] La imagen seleccionada no tiene dimensiones validas.');
    }

    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const pixels = size * size;
    const float32 = new Float32Array(3 * pixels);
    for (let i = 0; i < pixels; i++) {
      float32[i] = (data[i * 4] / 255 - mean[0]) / std[0];
      float32[pixels + i] = (data[i * 4 + 1] / 255 - mean[1]) / std[1];
      float32[2 * pixels + i] = (data[i * 4 + 2] / 255 - mean[2]) / std[2];
    }

    return new ort.Tensor('float32', float32, [1, 3, size, size]);
  }

  private postprocess(logits: Float32Array): OnnxPrediction {
    const { confidence_threshold, negative_class, classes } = this.meta!;
    const effectiveThreshold = Math.max(confidence_threshold, MIN_CONFIDENCE_THRESHOLD);
    const probs = this.softmax(logits);

    let topIdx = 0;
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > probs[topIdx]) topIdx = i;
    }

    const label = classes[topIdx];
    const confidence = probs[topIdx];
    const rejected = label === negative_class || confidence < effectiveThreshold;
    const rejectReason = label === negative_class
      ? 'negative_class'
      : confidence < effectiveThreshold
        ? 'low_confidence'
        : undefined;

    return { label, confidence, rejected, rejectReason };
  }

  private softmax(logits: Float32Array): Float32Array {
    const max = Math.max(...Array.from(logits));
    const exps = Array.from(logits).map(x => Math.exp(x - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return new Float32Array(exps.map(x => x / sum));
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('[MlInference] No se pudo decodificar la imagen.'));
      img.src = src;
    });
  }
}
