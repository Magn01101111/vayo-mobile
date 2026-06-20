"""
Utilidades compartidas del pipeline CNN VAYO.
Config, semilla, dispositivo, fábrica de modelos, congelado por fases, métricas y gráficos.
La justificación técnica de las decisiones está en justificacion-entrenamiento/.
"""
from __future__ import annotations

import json
import os
import random
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import yaml

# La consola de Windows (cp1252/cp850) no codifica algunos glifos; evita que un print crashee.
try:
    sys.stdout.reconfigure(errors="replace")
except Exception:  # noqa: BLE001
    pass

PROJECT_ROOT = Path(__file__).resolve().parent


# ─── Config / semilla / dispositivo ─────────────────────────────────────────
def load_config(path: str | os.PathLike = "config.yaml") -> dict:
    cfg_path = (PROJECT_ROOT / path) if not os.path.isabs(path) else Path(path)
    with open(cfg_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def resolve(*parts: str) -> Path:
    """Ruta absoluta relativa a la raíz del proyecto (la carpeta de este archivo)."""
    return PROJECT_ROOT.joinpath(*parts)


def seed_everything(seed: int = 42) -> None:
    """Fija las semillas para reproducibilidad de split, init y shuffle (doc 08).
    No se fuerza determinismo bit-a-bit de cuDNN/AMP para no sacrificar velocidad."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def get_device() -> torch.device:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def class_list(cfg: dict) -> list[str]:
    """Orden estable de clases: SKUs reales (ordenados) + clase negativa al final."""
    reales = sorted(cfg["classes"])
    neg = cfg.get("negative_class")
    return reales + ([neg] if neg else [])


# ─── Fábrica de modelos (doc 02) ────────────────────────────────────────────
from torchvision import models as tvm  # noqa: E402  (import tardío: torchvision es pesado)

_SUPPORTED = ("efficientnet_v2_s", "efficientnet_b0", "mobilenet_v3_large", "resnet50")


def build_model(name: str, num_classes: int, pretrained: bool = True) -> nn.Module:
    name = name.lower()
    if name == "efficientnet_v2_s":
        w = tvm.EfficientNet_V2_S_Weights.IMAGENET1K_V1 if pretrained else None
        m = tvm.efficientnet_v2_s(weights=w)
        m.classifier[1] = nn.Linear(m.classifier[1].in_features, num_classes)
    elif name == "efficientnet_b0":
        w = tvm.EfficientNet_B0_Weights.IMAGENET1K_V1 if pretrained else None
        m = tvm.efficientnet_b0(weights=w)
        m.classifier[1] = nn.Linear(m.classifier[1].in_features, num_classes)
    elif name == "mobilenet_v3_large":
        w = tvm.MobileNet_V3_Large_Weights.IMAGENET1K_V1 if pretrained else None
        m = tvm.mobilenet_v3_large(weights=w)
        m.classifier[3] = nn.Linear(m.classifier[3].in_features, num_classes)
    elif name == "resnet50":
        w = tvm.ResNet50_Weights.IMAGENET1K_V2 if pretrained else None
        m = tvm.resnet50(weights=w)
        m.fc = nn.Linear(m.fc.in_features, num_classes)
    else:
        raise ValueError(f"Modelo no soportado: {name}. Opciones: {_SUPPORTED}")
    return m


def _head(model: nn.Module, name: str) -> nn.Module:
    name = name.lower()
    if name.startswith(("efficientnet", "mobilenet")):
        return model.classifier
    return model.fc  # resnet


def _trunk_blocks(model: nn.Module, name: str) -> list[nn.Module]:
    """Bloques del backbone, de superficial a profundo, para descongelado parcial (doc 05)."""
    name = name.lower()
    if name.startswith(("efficientnet", "mobilenet")):
        return list(model.features.children())
    return [model.layer1, model.layer2, model.layer3, model.layer4]  # resnet


def _set_trainable(module: nn.Module, flag: bool) -> None:
    for p in module.parameters():
        p.requires_grad = flag


def configure_phase1(model: nn.Module, name: str) -> None:
    """Fase 1 — feature extraction: todo congelado salvo la cabeza nueva."""
    _set_trainable(model, False)
    _set_trainable(_head(model, name), True)


def configure_phase2(model: nn.Module, name: str, fine_tune_blocks: int) -> None:
    """Fase 2 — fine-tuning: cabeza + últimos N bloques del backbone (-1 = todo)."""
    if fine_tune_blocks is not None and fine_tune_blocks < 0:
        _set_trainable(model, True)
        return
    _set_trainable(_head(model, name), True)
    blocks = _trunk_blocks(model, name)
    for b in blocks[-fine_tune_blocks:] if fine_tune_blocks else []:
        _set_trainable(b, True)


def trainable_parameters(model: nn.Module):
    return [p for p in model.parameters() if p.requires_grad]


def count_trainable(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


# ─── Métricas (sin dependencias obligatorias) ───────────────────────────────
def confusion_matrix(y_true: np.ndarray, y_pred: np.ndarray, n: int) -> np.ndarray:
    cm = np.zeros((n, n), dtype=np.int64)
    for t, p in zip(y_true, y_pred):
        cm[t, p] += 1
    return cm


def classification_report(cm: np.ndarray, classes: list[str]) -> dict:
    """Precision/recall/F1 por clase + accuracy global, a partir de la matriz de confusión."""
    report = {}
    total = cm.sum()
    correct = np.trace(cm)
    for i, c in enumerate(classes):
        tp = cm[i, i]
        fp = cm[:, i].sum() - tp
        fn = cm[i, :].sum() - tp
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        report[c] = {"precision": prec, "recall": rec, "f1": f1, "support": int(cm[i, :].sum())}
    report["accuracy"] = float(correct / total) if total else 0.0
    return report


# ─── Gráficos ───────────────────────────────────────────────────────────────
def plot_history(history: list[dict], out_path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    ep = [h["epoch"] for h in history]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4.5))
    ax1.plot(ep, [h["train_loss"] for h in history], label="train")
    ax1.plot(ep, [h["val_loss"] for h in history], label="val")
    ax1.set_title("Loss"); ax1.set_xlabel("época"); ax1.legend(); ax1.grid(alpha=.3)
    ax2.plot(ep, [h["train_acc"] for h in history], label="train")
    ax2.plot(ep, [h["val_acc"] for h in history], label="val")
    ax2.set_title("Accuracy"); ax2.set_xlabel("época"); ax2.legend(); ax2.grid(alpha=.3)
    fig.tight_layout(); fig.savefig(out_path, dpi=120); plt.close(fig)


def plot_confusion(cm: np.ndarray, classes: list[str], out_path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(1.6 + 1.1 * len(classes), 1.4 + 1.1 * len(classes)))
    im = ax.imshow(cm, cmap="Blues")
    ax.set_xticks(range(len(classes))); ax.set_xticklabels(classes, rotation=45, ha="right")
    ax.set_yticks(range(len(classes))); ax.set_yticklabels(classes)
    ax.set_xlabel("predicho"); ax.set_ylabel("real"); ax.set_title("Matriz de confusión")
    thr = cm.max() / 2 if cm.max() else 0
    for i in range(len(classes)):
        for j in range(len(classes)):
            ax.text(j, i, int(cm[i, j]), ha="center", va="center",
                    color="white" if cm[i, j] > thr else "black")
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    fig.tight_layout(); fig.savefig(out_path, dpi=120); plt.close(fig)


def plot_confidence_hist(confs: np.ndarray, correct: np.ndarray, out_path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(8, 4.5))
    bins = np.linspace(0, 1, 21)
    ax.hist(confs[correct], bins=bins, alpha=.7, label="aciertos")
    ax.hist(confs[~correct], bins=bins, alpha=.7, label="errores")
    ax.set_title("Distribución de confianza (top-1)")
    ax.set_xlabel("confianza"); ax.set_ylabel("nº muestras"); ax.legend(); ax.grid(alpha=.3)
    fig.tight_layout(); fig.savefig(out_path, dpi=120); plt.close(fig)


def save_json(obj, path: Path) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
