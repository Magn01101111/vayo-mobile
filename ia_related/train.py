"""
train.py — entrenamiento en dos fases con transfer learning (ver justificacion-entrenamiento/).

Fase 1 (feature extraction): backbone congelado, se entrena solo la cabeza nueva.
Fase 2 (fine-tuning): se descongelan los últimos bloques, LR bajo + cosine + early stopping.
Precisión mixta (AMP), label smoothing y weight decay según config.yaml.

Uso:  python train.py
Salida: outputs/best.pt, outputs/history.json, outputs/curves.png, outputs/training_summary.json
"""
from __future__ import annotations

import contextlib
import time
from pathlib import Path

import torch
import torch.nn as nn
from torch.optim.lr_scheduler import CosineAnnealingLR, LinearLR, SequentialLR
from tqdm import tqdm

from dataset import build_dataloaders
from utils import (PROJECT_ROOT, build_model, class_list, configure_phase1, configure_phase2,
                   count_trainable, get_device, load_config, plot_history, save_json,
                   seed_everything, trainable_parameters)


def amp_context(device: torch.device, use_amp: bool, dtype: torch.dtype):
    if use_amp and device.type == "cuda":
        return torch.autocast(device_type="cuda", dtype=dtype)
    return contextlib.nullcontext()


def run_epoch(model, loader, criterion, device, *, use_amp, amp_dtype, optimizer=None,
              scaler=None, accum=1, desc=""):
    train = optimizer is not None
    model.train() if train else model.eval()
    total_loss, correct, n = 0.0, 0, 0
    if train:
        optimizer.zero_grad(set_to_none=True)
    grad_ctx = contextlib.nullcontext() if train else torch.no_grad()

    with grad_ctx:
        for i, (x, y) in enumerate(tqdm(loader, desc=desc, leave=False)):
            x = x.to(device, non_blocking=True)
            y = y.to(device, non_blocking=True)
            with amp_context(device, use_amp, amp_dtype):
                out = model(x)
                loss = criterion(out, y)
            if train:
                bloss = loss / accum
                if scaler is not None and scaler.is_enabled():
                    scaler.scale(bloss).backward()
                    if (i + 1) % accum == 0:
                        scaler.step(optimizer)
                        scaler.update()
                        optimizer.zero_grad(set_to_none=True)
                else:
                    bloss.backward()
                    if (i + 1) % accum == 0:
                        optimizer.step()
                        optimizer.zero_grad(set_to_none=True)
            total_loss += loss.item() * x.size(0)
            correct += (out.argmax(1) == y).sum().item()
            n += x.size(0)
    return total_loss / n, correct / n


def main() -> None:
    cfg = load_config()
    seed_everything(int(cfg["seed"]))
    device = get_device()
    tcfg = cfg["train"]
    classes = class_list(cfg)
    out_dir = PROJECT_ROOT / cfg["outputs_dir"]
    out_dir.mkdir(parents=True, exist_ok=True)

    use_amp = bool(tcfg["amp"]) and device.type == "cuda"
    amp_dtype = torch.bfloat16 if tcfg["amp_dtype"] == "bfloat16" else torch.float16
    use_scaler = use_amp and amp_dtype == torch.float16
    accum = int(tcfg.get("accumulation_steps", 1))

    print(f"Dispositivo: {device}  |  AMP: {use_amp} ({tcfg['amp_dtype']})  |  clases: {classes}")

    train_dl, val_dl, _ = build_dataloaders(cfg, classes)
    model = build_model(cfg["model"]["name"], len(classes), cfg["model"]["pretrained"]).to(device)
    criterion = nn.CrossEntropyLoss(label_smoothing=float(tcfg["label_smoothing"]))
    scaler = torch.amp.GradScaler("cuda", enabled=use_scaler)

    history: list[dict] = []
    monitor = tcfg["early_stopping"]["monitor"]                 # "val_acc" o "val_loss"
    es_enabled = bool(tcfg["early_stopping"].get("enabled", True))
    patience = int(tcfg["early_stopping"]["patience"])
    # best_* siguen al MEJOR modelo en validación. Cuando la val_acc empata (p.ej. satura en
    # 1.0 con este dataset chico), se desempata por menor val_loss → best.pt queda más afinado.
    best_acc, best_loss, best_epoch, wait = -1.0, float("inf"), 0, 0
    t0 = time.time()

    def make_ckpt(epoch, va_acc, va_loss):
        """Checkpoint = pesos + metadatos, para que evaluate/export/predict no relean la config."""
        return {"model_state": model.state_dict(), "classes": classes,
                "model_name": cfg["model"]["name"], "img_size": cfg["image"]["size"],
                "mean": cfg["image"]["mean"], "std": cfg["image"]["std"],
                "epoch": epoch, "val_acc": va_acc, "val_loss": va_loss}

    def validate(epoch, phase, tr_loss, tr_acc):
        nonlocal best_acc, best_loss, best_epoch, wait
        va_loss, va_acc = run_epoch(model, val_dl, criterion, device, use_amp=use_amp,
                                    amp_dtype=amp_dtype, desc=f"val e{epoch}")
        history.append({"epoch": epoch, "phase": phase, "train_loss": tr_loss,
                        "train_acc": tr_acc, "val_loss": va_loss, "val_acc": va_acc,
                        "lr": optimizer.param_groups[0]["lr"]})
        print(f"  época {epoch:3d} [{phase}]  train_loss={tr_loss:.4f} acc={tr_acc:.3f}  "
              f"val_loss={va_loss:.4f} acc={va_acc:.3f}")

        ckpt = make_ckpt(epoch, va_acc, va_loss)
        # last.pt = SIEMPRE el estado de la última época corrida (no necesariamente el mejor).
        # Son dos conceptos distintos: 'best' = mejor en validación; 'last' = el más entrenado.
        torch.save(ckpt, out_dir / "last.pt")

        if monitor == "val_acc":
            improved = (va_acc > best_acc) or (va_acc == best_acc and va_loss < best_loss)
        else:
            improved = va_loss < best_loss
        if improved:
            best_acc, best_loss, best_epoch, wait = va_acc, va_loss, epoch, 0
            torch.save(ckpt, out_dir / "best.pt")     # best.pt = mejor en validación hasta ahora
        else:
            wait += 1
        return improved

    # ── Fase 1 — feature extraction ─────────────────────────────────────────
    configure_phase1(model, cfg["model"]["name"])
    optimizer = torch.optim.AdamW(trainable_parameters(model), lr=float(tcfg["phase1"]["lr"]),
                                  weight_decay=float(tcfg["weight_decay"]))
    print(f"\n[Fase 1] feature extraction · params entrenables: {count_trainable(model):,}")
    epoch = 0
    for _ in range(int(tcfg["phase1"]["epochs"])):
        epoch += 1
        tr_loss, tr_acc = run_epoch(model, train_dl, criterion, device, use_amp=use_amp,
                                    amp_dtype=amp_dtype, optimizer=optimizer, scaler=scaler,
                                    accum=accum, desc=f"train e{epoch}")
        validate(epoch, "p1", tr_loss, tr_acc)

    # ── Fase 2 — fine-tuning ────────────────────────────────────────────────
    configure_phase2(model, cfg["model"]["name"], int(tcfg["phase2"]["fine_tune_blocks"]))
    optimizer = torch.optim.AdamW(trainable_parameters(model), lr=float(tcfg["phase2"]["lr"]),
                                  weight_decay=float(tcfg["weight_decay"]))
    p2_epochs = int(tcfg["phase2"]["epochs"])
    warmup = int(tcfg["phase2"].get("warmup_epochs", 0))
    if warmup > 0:
        scheduler = SequentialLR(
            optimizer,
            [LinearLR(optimizer, start_factor=0.1, total_iters=warmup),
             CosineAnnealingLR(optimizer, T_max=max(1, p2_epochs - warmup))],
            milestones=[warmup])
    else:
        scheduler = CosineAnnealingLR(optimizer, T_max=p2_epochs)
    print(f"\n[Fase 2] fine-tuning · params entrenables: {count_trainable(model):,}")

    for _ in range(p2_epochs):
        epoch += 1
        tr_loss, tr_acc = run_epoch(model, train_dl, criterion, device, use_amp=use_amp,
                                    amp_dtype=amp_dtype, optimizer=optimizer, scaler=scaler,
                                    accum=accum, desc=f"train e{epoch}")
        validate(epoch, "p2", tr_loss, tr_acc)
        scheduler.step()
        # Early stopping solo si está habilitado en config (aquí está OFF a propósito; ver config).
        if es_enabled and wait >= patience:
            print(f"  [early-stop] sin mejora en {patience} épocas")
            break

    # ── Cierre ───────────────────────────────────────────────────────────────
    mins = (time.time() - t0) / 60
    save_json(history, out_dir / "history.json")
    plot_history(history, out_dir / "curves.png")
    save_json({"best_epoch": best_epoch, "best_val_acc": best_acc, "best_val_loss": best_loss,
               "monitor": monitor, "early_stopping": es_enabled, "epochs_run": epoch,
               "minutes": round(mins, 2), "device": str(device), "classes": classes,
               "model": cfg["model"]["name"]}, out_dir / "training_summary.json")
    print(f"\n[OK] {epoch} épocas en {mins:.1f} min.")
    print(f"     best.pt -> época {best_epoch} (val_acc={best_acc:.4f}, val_loss={best_loss:.4f}) — MEJOR en validación")
    print(f"     last.pt -> época {epoch} — la ÚLTIMA (no necesariamente la mejor)")


if __name__ == "__main__":
    main()
