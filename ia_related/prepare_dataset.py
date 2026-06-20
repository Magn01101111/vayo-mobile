"""
prepare_dataset.py — construye el dataset de entrenamiento de forma profesional y reproducible.

Qué hace (ver justificacion-entrenamiento/08):
1. Lee las clases reales (SKU) desde config.yaml y reúne, por clase, DOS fuentes de positivos:
     - raw_dir/<SKU>/      -> recortes con fondo transparente  -> mode="composite"
                              (se pegan sobre fondos procedurales al entrenar; doc 07)
     - extra_dir/<SKU>/    -> FOTOS REALES del producto        -> mode="real"
                              (traen su propio fondo: se usan tal cual, sin compositing)
2. Hace un split ESTRATIFICADO 70/15/15 por clase, con SEMILLA FIJA y SIN FUGA DE DATOS
   (primero se reparten las imágenes fuente; la augmentation ocurre después, online).
3. Construye la clase negativa "otros" combinando:
     - extra_dir/otros/    -> NEGATIVOS reales (otros productos/objetos)  -> mode="real"
     - negativos SINTÉTICOS (solo fondo procedural, sin producto)          -> mode="bg"
   La cantidad sintética se calcula para BALANCEAR negativos ≈ positivos por split.
4. Copia los archivos fuente a dataset/{train,val,test}/<clase>/ (para poder inspeccionarlos).
   OJO: dataset/ se BORRA y regenera en cada corrida; las fotos reales viven en data_extra/
   (fuera de dataset/) y por eso persisten.
5. Escribe dataset/manifest.csv (fuente de verdad, con columna `mode`), labels.json y stats.json.

Uso:  python prepare_dataset.py
"""
from __future__ import annotations

import csv
import shutil
from pathlib import Path

import numpy as np

from utils import PROJECT_ROOT, class_list, load_config, save_json, seed_everything

IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def list_images(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in IMG_EXT)


def split_counts(n: int, ratios: dict) -> tuple[int, int, int]:
    """Reparte n en (train, val, test) garantizando ≥1 en val y test cuando hay datos suficientes."""
    n_test = round(n * ratios["test"])
    n_val = round(n * ratios["val"])
    if n >= 3:                       # con ≥3 imágenes asegura presencia en val y test
        n_test = max(1, n_test)
        n_val = max(1, n_val)
    n_train = n - n_val - n_test
    return n_train, n_val, n_test


def main() -> None:
    cfg = load_config()
    seed = int(cfg["seed"])
    seed_everything(seed)
    rs = np.random.RandomState(seed)        # RNG dedicado a split y semillas de fila (reproducible)

    raw_dir = PROJECT_ROOT / cfg["raw_dir"]
    extra_dir = PROJECT_ROOT / cfg.get("extra_dir", "data_extra")
    out_dir = PROJECT_ROOT / cfg["dataset_dir"]
    classes = class_list(cfg)
    neg = cfg.get("negative_class")
    ratios = cfg["split"]
    neg_ratio = float(cfg["negatives"]["ratio_per_split"])

    if out_dir.exists():
        shutil.rmtree(out_dir)              # limpia para evitar restos de corridas previas
    out_dir.mkdir(parents=True)

    rows: list[dict] = []
    stats: dict = {"seed": seed, "classes": classes, "per_class": {}, "per_split": {}}
    split_pos = {"train": 0, "val": 0, "test": 0}   # positivos (solo clases reales) por split

    def add_pool(label: str, pool: list[tuple[Path, str]], track_pos: bool) -> dict:
        """Baraja un conjunto de (archivo, mode), lo reparte 70/15/15, copia y registra filas."""
        order = rs.permutation(len(pool))
        pool = [pool[i] for i in order]
        n_tr, n_va, n_te = split_counts(len(pool), ratios)
        assignment = (["train"] * n_tr) + (["val"] * n_va) + (["test"] * n_te)
        counts = {"train": 0, "val": 0, "test": 0}
        for split, (src, mode) in zip(assignment, pool):
            dst_dir = out_dir / split / label
            dst_dir.mkdir(parents=True, exist_ok=True)
            dst = dst_dir / src.name
            shutil.copy2(src, dst)
            rows.append({"split": split, "label": label,
                         "path": str(dst.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                         "seed": int(rs.randint(0, 2**31 - 1)), "mode": mode})
            counts[split] += 1
            if track_pos:
                split_pos[split] += 1
        return counts

    # --- Clases reales (SKU): recortes (composite) + fotos reales (real) -----
    for cls in cfg["classes"]:
        cutouts = [(p, "composite") for p in list_images(raw_dir / cls)]
        reales = [(p, "real") for p in list_images(extra_dir / cls)]
        pool = cutouts + reales
        if not pool:
            raise SystemExit(f"[ERROR] La clase '{cls}' no tiene imágenes en {raw_dir / cls} "
                             f"ni en {extra_dir / cls}")
        counts = add_pool(cls, pool, track_pos=True)
        stats["per_class"][cls] = {"total": len(pool), **counts,
                                   "recortes": len(cutouts), "reales": len(reales)}
        print(f"  {cls:20s} total={len(pool):3d} (recortes={len(cutouts)}, reales={len(reales)})  "
              f"train={counts['train']} val={counts['val']} test={counts['test']}")

    # --- Clase negativa: reales (data_extra/otros) + sintéticos para balancear -
    if neg:
        real_neg = [(p, "real") for p in list_images(extra_dir / neg)]
        counts = add_pool(neg, real_neg, track_pos=False) if real_neg else {"train": 0, "val": 0, "test": 0}
        synth = {"train": 0, "val": 0, "test": 0}
        for split in ("train", "val", "test"):
            target = round(split_pos[split] * neg_ratio)          # negativos ≈ positivos
            n_syn = max(0, target - counts[split])                # completa con sintéticos
            for _ in range(n_syn):
                rows.append({"split": split, "label": neg, "path": "",
                             "seed": int(rs.randint(0, 2**31 - 1)), "mode": "bg"})
            synth[split] = n_syn
        total_neg = {s: counts[s] + synth[s] for s in counts}
        stats["per_class"][neg] = {"total": sum(total_neg.values()), **total_neg,
                                   "reales": sum(counts.values()), "sinteticos": sum(synth.values())}
        print(f"  {neg:20s} total={sum(total_neg.values()):3d} "
              f"(reales={sum(counts.values())}, sintéticos={sum(synth.values())})  "
              f"train={total_neg['train']} val={total_neg['val']} test={total_neg['test']}")

    # --- Escritura -----------------------------------------------------------
    manifest = out_dir / "manifest.csv"
    with open(manifest, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["split", "label", "path", "seed", "mode"])
        w.writeheader()
        w.writerows(rows)

    save_json({str(i): c for i, c in enumerate(classes)}, out_dir / "labels.json")
    split_totals = {s: sum(1 for r in rows if r["split"] == s) for s in ("train", "val", "test")}
    stats["per_split"] = split_totals
    stats["total_samples"] = len(rows)
    save_json(stats, out_dir / "stats.json")

    print("\n[OK] Dataset preparado.")
    print(f"     Clases ({len(classes)}): {classes}")
    print(f"     Muestras por split: {split_totals}  (positivos + negativos)")
    print(f"     Manifest: {manifest.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
