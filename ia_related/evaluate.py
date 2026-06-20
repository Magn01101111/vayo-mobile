"""
evaluate.py — evalúa el mejor checkpoint sobre el conjunto de TEST (intocado en el entrenamiento).

Reporta accuracy, matriz de confusión, precisión/recall/F1 por clase, histograma de confianza
y un barrido de umbral de rechazo (doc 09) para ayudar a calibrar inference.confidence_threshold.

Uso:  python evaluate.py
Salida: outputs/metrics.json, outputs/confusion_matrix.png, outputs/confidence_hist.png
"""
from __future__ import annotations

import sys

import numpy as np
import torch

from dataset import build_dataloaders
from utils import (PROJECT_ROOT, build_model, class_list, classification_report,
                   confusion_matrix, get_device, load_config, plot_confidence_hist,
                   plot_confusion, save_json)


@torch.no_grad()
def infer(model, loader, device):
    probs_all, labels_all = [], []
    for x, y in loader:
        x = x.to(device, non_blocking=True)
        probs = torch.softmax(model(x), dim=1).cpu().numpy()
        probs_all.append(probs)
        labels_all.append(y.numpy())
    return np.concatenate(probs_all), np.concatenate(labels_all)


def main() -> None:
    cfg = load_config()
    device = get_device()
    classes = class_list(cfg)
    out_dir = PROJECT_ROOT / cfg["outputs_dir"]
    # Permite evaluar best.pt (por defecto) o last.pt:  python evaluate.py last
    which = sys.argv[1] if len(sys.argv) > 1 else "best"
    ckpt_name = "last.pt" if which.startswith("last") else "best.pt"
    ckpt_path = out_dir / ckpt_name
    if not ckpt_path.exists():
        raise SystemExit(f"[ERROR] No existe outputs/{ckpt_name}. Corre primero train.py.")
    print(f"Evaluando checkpoint: {ckpt_name}")

    ckpt = torch.load(ckpt_path, map_location=device, weights_only=False)
    model = build_model(ckpt["model_name"], len(classes), pretrained=False).to(device)
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    _, _, test_dl = build_dataloaders(cfg, classes)
    probs, labels = infer(model, test_dl, device)
    preds = probs.argmax(1)
    confs = probs.max(1)
    correct = preds == labels

    cm = confusion_matrix(labels, preds, len(classes))
    report = classification_report(cm, classes)
    acc = report["accuracy"]

    print(f"\n=== TEST · {len(labels)} muestras ===")
    print(f"Accuracy global: {acc:.4f}\n")
    print(f"{'clase':22s} {'prec':>6} {'recall':>7} {'f1':>6} {'n':>4}")
    for c in classes:
        r = report[c]
        print(f"{c:22s} {r['precision']:6.3f} {r['recall']:7.3f} {r['f1']:6.3f} {r['support']:4d}")

    # Barrido de umbral de rechazo (doc 09)
    print("\n=== Barrido de umbral (calibración del rechazo) ===")
    print(f"{'umbral':>7} {'cobertura':>10} {'acc_aceptados':>14}")
    thr_table = []
    for thr in np.round(np.arange(0.50, 0.96, 0.05), 2):
        acc_mask = confs >= thr
        cov = float(acc_mask.mean())
        acc_acc = float((preds[acc_mask] == labels[acc_mask]).mean()) if acc_mask.any() else float("nan")
        thr_table.append({"threshold": float(thr), "coverage": cov, "accuracy_accepted": acc_acc})
        print(f"{thr:7.2f} {cov:10.3f} {acc_acc:14.3f}")

    plot_confusion(cm, classes, out_dir / "confusion_matrix.png")
    plot_confidence_hist(confs, correct, out_dir / "confidence_hist.png")
    save_json({"accuracy": acc, "per_class": {c: report[c] for c in classes},
               "confusion_matrix": cm.tolist(), "classes": classes,
               "threshold_sweep": thr_table,
               "n_test": int(len(labels))}, out_dir / "metrics.json")
    print(f"\n[OK] Métricas y gráficos en {out_dir.relative_to(PROJECT_ROOT)}/")


if __name__ == "__main__":
    main()
