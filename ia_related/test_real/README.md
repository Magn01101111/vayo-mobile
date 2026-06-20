# test_real/ — fotos reales SOLO para probar (no se entrena con ellas)

Carpeta de **prueba manual** con fotos reales del producto (fondos reales, distintas luces y
encuadres). Sirve para medir **generalización al caso real**, que es lo que de verdad importa:
el modelo se entrena con recortes + fondos sintéticos, así que esta carpeta es el "examen" honesto.

**Por qué está separada de `dataset/`:** `prepare_dataset.py` borra `dataset/` en cada corrida.
Aquí las fotos persisten.

**Cómo se usa:**
```bash
python predict.py                 # clasifica todo test_real/ con best.pt
python predict.py test_real last  # idem, pero con last.pt
```
Salida por imagen: clase predicha, confianza y P(SKU), aplicando el umbral de rechazo.

⚠️ **No entrenes con estas imágenes.** Si las usaras también en `data_extra/` (entrenamiento),
habría *fuga de datos* (data leakage) y las métricas dejarían de ser creíbles. Mantén separados
lo que entrena (`data_extra/`) y lo que prueba (`test_real/`).
