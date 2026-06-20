# Clasificador CNN VAYO — reconocimiento de repuestos

Pipeline de **clasificación de imágenes** (transfer learning con **EfficientNetV2-S**) para
reconocer un repuesto a partir de una foto, en el camino **CNN → Google Cloud Run** del
proyecto VAYO. Las imágenes fuente son **recortes con fondo transparente**; el modelo los
aprende pegándolos sobre **fondos generados proceduralmente**.

> **Por qué de cada decisión técnica:** ver la carpeta
> [`justificacion-entrenamiento/`](justificacion-entrenamiento/00_README.md) (material de defensa).

---

## 1. Entorno

```bash
conda activate yolo          # ya tiene todo lo necesario
pip install -r requirements.txt   # opcional; no instala nada nuevo si ya están
```
GPU detectada y verificada: **RTX 5060** con `torch 2.11+cu128` (CUDA disponible).

## 2. Estructura

```
ia_related/
├─ CTRL-ETG-4AMF25/              # recortes fuente con fondo transparente (1 carpeta por SKU = 1 clase)
├─ data_extra/                   # FOTOS REALES para entrenar (persisten): <SKU>/ y otros/  → ver su README
├─ test_real/                    # fotos reales SOLO para probar (no se entrena con ellas) → ver su README
├─ config.yaml                   # TODOS los hiperparámetros, en un solo lugar
├─ prepare_dataset.py            # 1) split 70/15/15 + manifest + mezcla data_extra + clase negativa
├─ dataset.py                    # compositing/augmentation + manejo de fotos reales
├─ train.py                      # 2) entrenamiento en 2 fases (AMP, cosine); guarda best.pt y last.pt
├─ evaluate.py                   # 3) métricas sobre test + calibración de umbral
├─ export_onnx.py                # 4) export a ONNX + verificación + bundle GCR
├─ predict.py                    # (cuando quieras) clasifica fotos sueltas / test_real
├─ utils.py                      # modelo, fases, métricas, gráficos
├─ justificacion-entrenamiento/  # documentos de defensa (porqué de cada decisión)
├─ dataset/                      # (generado, SE BORRA c/corrida) train/ val/ test/ + manifest.csv
└─ outputs/                      # (generado) best.pt, last.pt, curvas, métricas, model.onnx, ...
```

**Checkpoints:** `best.pt` = mejor época en validación (desempate por `val_loss`); `last.pt` =
última época (el más entrenado, no necesariamente el mejor). El early stopping viene **desactivado**
por defecto (ver `config.yaml` y [doc 05](justificacion-entrenamiento/05_dos-fases-optimizador-scheduler.md)).

## 3. Orden de ejecución

```bash
conda activate yolo
cd "C:\Users\jorge\Documents\vayo-solutions\vayo-mobile\ia_related"

python prepare_dataset.py     # arma dataset/ (reproducible con seed)
python train.py               # entrena → outputs/best.pt + curves.png
python evaluate.py            # outputs/metrics.json + confusion_matrix.png + confidence_hist.png
python export_onnx.py         # outputs/model.onnx + labels.json + inference_meta.json
```

La primera vez, `train.py` descarga los pesos preentrenados de EfficientNetV2-S (~82 MB, requiere
internet).

### Probar con fotos reales / elegir checkpoint

```bash
python predict.py                 # clasifica test_real/ con best.pt (1 imagen → SKU + confianza)
python predict.py test_real last  # idem con last.pt
python predict.py "ruta/a/foto.webp"   # una sola imagen
python evaluate.py last            # evalúa last.pt en vez de best.pt
```

Para **mejorar** el modelo: pon fotos reales del producto en `data_extra/CTRL-ETG-4AMF25/` y de
otros productos en `data_extra/otros/`, y vuelve a correr desde `prepare_dataset.py`. (No reutilices
en `data_extra/` las mismas fotos de `test_real/`: sería fuga de datos.)

## 4. Agregar más productos (escala multiclase)

1. Crea `ia_related/<NUEVO-SKU>/` con sus imágenes (idealmente recortes con fondo transparente).
2. Añádelo a `classes:` en `config.yaml`.
3. Reejecuta `prepare_dataset.py → train.py → evaluate.py → export_onnx.py`.

El pipeline ya es multiclase; la clase negativa `otros` se mantiene para el rechazo (ver
[doc 09](justificacion-entrenamiento/09_clase-negativa-y-umbral.md)).

## 5. Ajustes frecuentes (`config.yaml`)

| Si… | Cambia |
|---|---|
| Hay *Out Of Memory* | `train.batch_size: 8` (y opcional `accumulation_steps: 2`) |
| Quieres un modelo más liviano para GCR | `model.name: efficientnet_b0` **y** `image.size: 224` |
| Aparecen `NaN` en la loss | `train.amp_dtype: bfloat16` |
| El modelo sobreajusta | sube `augment.*`, baja `phase2.epochs`, sube `weight_decay` |
| Quieres más/menos rechazo | ajusta `inference.confidence_threshold` según el barrido de `evaluate.py` |

## 6. Salida para el microservicio (GCR)

`export_onnx.py` deja en `outputs/` el *bundle* que necesita el servicio de inferencia:
- **`model.onnx`** — batch dinámico; la salida son **logits** (aplicar `softmax` en el servicio).
- **`labels.json`** — índice → SKU (`otros` = clase negativa / rechazo).
- **`inference_meta.json`** — tamaño de entrada, normalización (mean/std), orden RGB y
  `confidence_threshold`. La regla de decisión: si `max(softmax) < umbral` o la clase ganadora
  es `otros` → **"no reconocido"**; si no, devolver el SKU. Mapea a `DetectionResult` (§9):
  `label`=SKU, `confidence`=probabilidad, sin *bounding box*.

## 7. Limitaciones conocidas (honestas para la defensa)

- **Dataset pequeño** (62 imágenes, 1 producto): las métricas de test son indicativas. Plan:
  k-fold y, sobre todo, **recolectar fotos con fondos reales** del producto en uso.
- **Negativos sintéticos** (fondos sin producto): rechazan "no-producto" genérico, pero para
  rechazar *otros productos parecidos* conviene sumar SKUs reales como nuevas clases.
- Detalle completo en [doc 08](justificacion-entrenamiento/08_particion-dataset.md) y
  [doc 09](justificacion-entrenamiento/09_clase-negativa-y-umbral.md).
