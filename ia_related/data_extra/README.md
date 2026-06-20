# data_extra/ — fotos REALES que SÍ se usan para entrenar

Aquí pones fotos reales para **mejorar** el modelo. A diferencia de `dataset/` (que se borra y
regenera en cada `prepare_dataset.py`), esta carpeta **persiste**: es tu fuente de datos reales.

`prepare_dataset.py` mezcla automáticamente lo que haya aquí con los recortes de `raw_dir`,
respetando el mismo split 70/15/15.

## Estructura
```
data_extra/
├─ CTRL-ETG-4AMF25/   → fotos reales DEL producto (POSITIVOS)
└─ otros/             → fotos de OTROS productos/objetos (NEGATIVOS reales)
```

## Cómo trata cada cosa el pipeline
- **`CTRL-ETG-4AMF25/`** (y futuras carpetas de SKU): son fotos con su propio fondo, así que se
  usan **tal cual** (modo `real`), sin pegarlas sobre fondos procedurales. Solo se les aplica
  augmentation suave (recorte, flip, color) en entrenamiento.
- **`otros/`**: negativos **reales**. Son clave para que el modelo aprenda a **rechazar
  productos parecidos** (p. ej. otros controladores ComAp como el InteliSys), algo que los
  negativos sintéticos (solo fondo) no enseñan. Ver [doc 09](../justificacion-entrenamiento/09_clase-negativa-y-umbral.md).
- Los negativos **sintéticos** (solo fondo) se siguen generando automáticamente para **balancear**
  negativos ≈ positivos por split. Si agregas muchos negativos reales, se generan menos sintéticos.

## Para agregar un producto nuevo (multiclase)
1. Crea `data_extra/<NUEVO-SKU>/` con sus fotos (o `raw_dir/<NUEVO-SKU>/` si son recortes).
2. Añade `<NUEVO-SKU>` a `classes:` en `config.yaml`.
3. Reejecuta el pipeline (`prepare_dataset.py → train.py → ...`).

⚠️ **No uses aquí las mismas imágenes de `test_real/`** (sería fuga de datos: entrenarías y
probarías con lo mismo, inflando las métricas). Si están vacías, el entrenamiento usa solo los
recortes de `raw_dir` + negativos sintéticos (comportamiento original).
