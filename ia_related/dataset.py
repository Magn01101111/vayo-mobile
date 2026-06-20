"""
Dataset y data augmentation del clasificador CNN VAYO.

Pieza central: las imágenes son recortes con fondo transparente (canal alfa), así que en
cada acceso el producto se "pega" (composite) sobre un fondo generado proceduralmente —para
que el modelo aprenda el objeto y no un fondo fijo (ver justificacion-entrenamiento/07).

- Augmentation aleatoria SOLO en train; val/test usan compositing determinista (semilla por
  muestra) para que las métricas sean estables y comparables (ver doc 07 y 08).
- La clase negativa ("otros") = un fondo procedural SIN producto (ver doc 09).
"""
from __future__ import annotations

import csv
import random
from pathlib import Path

import numpy as np
import torch
import torchvision.transforms as T
from PIL import Image, ImageOps
from torch.utils.data import DataLoader, Dataset

from utils import PROJECT_ROOT

RES = Image.Resampling
_CUTOUT_MAX_SIDE = 768  # cacheamos recortes reducidos: composite a 384 no necesita 4000 px


# ─── Fondos procedurales (doc 07) ───────────────────────────────────────────
def _color(rng) -> np.ndarray:
    return rng.randint(0, 256, size=3).astype(np.float32)


def make_background(size: tuple[int, int], rng) -> Image.Image:
    """Genera un fondo RGB variado: sólido, gradiente, franjas, tablero, ruido o manchas."""
    w, h = size
    kind = rng.randint(0, 6)
    if kind == 0:  # sólido
        arr = np.ones((h, w, 3), np.float32) * _color(rng)
    elif kind == 1:  # gradiente
        c0, c1 = _color(rng), _color(rng)
        if rng.randint(0, 2):
            t = np.linspace(0, 1, w, dtype=np.float32)[None, :, None]
        else:
            t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
        arr = c0 * (1 - t) + c1 * t
        arr = np.broadcast_to(arr, (h, w, 3)).copy()
    elif kind == 2:  # franjas
        c0, c1 = _color(rng), _color(rng)
        period = int(rng.randint(12, 48))
        horiz = bool(rng.randint(0, 2))
        idx = (np.arange(h)[:, None] if horiz else np.arange(w)[None, :])
        band = ((idx // period) % 2).astype(np.float32)
        band = np.broadcast_to(band, (h, w))[..., None]
        arr = c0 * (1 - band) + c1 * band
    elif kind == 3:  # tablero
        c0, c1 = _color(rng), _color(rng)
        cell = int(rng.randint(16, 64))
        gx = (np.arange(w)[None, :] // cell) % 2
        gy = (np.arange(h)[:, None] // cell) % 2
        chk = (gx ^ gy).astype(np.float32)[..., None]
        arr = c0 * (1 - chk) + c1 * chk
    elif kind == 4:  # ruido fino
        arr = rng.randint(0, 256, size=(h, w, 3)).astype(np.float32)
    else:  # manchas suaves (ruido low-res ampliado)
        small = rng.randint(0, 256, size=(max(2, h // 32), max(2, w // 32), 3)).astype(np.uint8)
        arr = np.asarray(Image.fromarray(small).resize((w, h), RES.BICUBIC), np.float32)

    arr *= rng.uniform(0.7, 1.15)  # jitter de brillo
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


# ─── Recorte (cutout) con alfa ──────────────────────────────────────────────
def load_cutout(path: Path) -> Image.Image:
    """Carga RGBA, recorta al bounding box del alfa y reduce para acelerar el composite."""
    im = Image.open(path).convert("RGBA")
    bbox = im.getchannel("A").getbbox()
    if bbox:
        im = im.crop(bbox)
    if max(im.size) > _CUTOUT_MAX_SIDE:
        f = _CUTOUT_MAX_SIDE / max(im.size)
        im = im.resize((max(1, round(im.width * f)), max(1, round(im.height * f))), RES.LANCZOS)
    return im


def composite(cutout: Image.Image, size: int, rng, aug: dict, train: bool,
              geo: T.Compose | None) -> Image.Image:
    """Pega el recorte sobre un fondo procedural a tamaño `size`×`size` (RGB)."""
    if train and geo is not None:
        pad = int(0.25 * max(cutout.size))          # margen para que rotación/perspectiva no recorten
        cutout = ImageOps.expand(cutout, border=pad, fill=(0, 0, 0, 0))
        cutout = geo(cutout)
        scale = rng.uniform(aug["scale_min"], aug["scale_max"])
    else:
        scale = (aug["scale_min"] + aug["scale_max"]) / 2.0

    cw, ch = cutout.size
    f = (scale * size) / max(cw, ch)
    new = (max(1, round(cw * f)), max(1, round(ch * f)))
    prod = cutout.resize(new, RES.LANCZOS)

    bg = make_background((size, size), rng)
    maxx, maxy = size - new[0], size - new[1]
    if train:
        x = int(rng.randint(0, max(0, maxx) + 1))
        y = int(rng.randint(0, max(0, maxy) + 1))
    else:
        x, y = max(0, maxx) // 2, max(0, maxy) // 2     # centrado y determinista
    bg.paste(prod, (x, y), prod)                          # usa el alfa como máscara
    return bg


# ─── Transformaciones ───────────────────────────────────────────────────────
def build_geo(aug: dict) -> T.Compose:
    """Geometría aplicada al recorte RGBA (relleno transparente, fill=0)."""
    return T.Compose([
        T.RandomHorizontalFlip(aug["hflip_p"]),
        T.RandomPerspective(distortion_scale=aug["perspective"], p=aug["perspective_p"], fill=0),
        T.RandomAffine(degrees=aug["rotation_deg"], shear=aug["shear_deg"],
                       scale=tuple(aug["scale_jitter"]), fill=0),
    ])


def build_post(cfg: dict, train: bool) -> T.Compose:
    """Fotométrica + tensor + normalización (+ random erasing en train).
    Se aplica al RESULTADO del compositing (modos 'composite' y 'bg'), que ya viene a `size`."""
    mean, std = cfg["image"]["mean"], cfg["image"]["std"]
    if not train:
        return T.Compose([T.ToTensor(), T.Normalize(mean, std)])
    aug = cfg["augment"]
    return T.Compose([
        T.ColorJitter(*aug["color_jitter"]),
        T.RandomApply([T.GaussianBlur(kernel_size=5, sigma=(0.1, 2.0))], p=aug["blur_p"]),
        T.ToTensor(),
        T.Normalize(mean, std),
        T.RandomErasing(p=aug["erasing_p"]),
    ])


def build_real(cfg: dict, train: bool) -> T.Compose:
    """Transform para FOTOS REALES (modo 'real', de data_extra/): ya traen su propio fondo, así
    que NO se hace compositing. En train se aumenta con recorte/escala/flip/color/blur/erasing;
    en val/test solo se redimensiona de forma determinista (igual que en predict.py)."""
    size = cfg["image"]["size"]
    mean, std = cfg["image"]["mean"], cfg["image"]["std"]
    if not train:
        return T.Compose([T.Resize((size, size)), T.ToTensor(), T.Normalize(mean, std)])
    aug = cfg["augment"]
    return T.Compose([
        T.RandomResizedCrop(size, scale=(0.6, 1.0), ratio=(0.75, 1.333)),
        T.RandomHorizontalFlip(aug["hflip_p"]),
        T.ColorJitter(*aug["color_jitter"]),
        T.RandomApply([T.GaussianBlur(kernel_size=5, sigma=(0.1, 2.0))], p=aug["blur_p"]),
        T.ToTensor(),
        T.Normalize(mean, std),
        T.RandomErasing(p=aug["erasing_p"]),
    ])


# ─── Dataset ────────────────────────────────────────────────────────────────
class ProductDataset(Dataset):
    def __init__(self, rows: list[dict], classes: list[str], cfg: dict, train: bool):
        self.rows = rows
        self.classes = classes
        self.cfg = cfg
        self.train = train
        self.size = cfg["image"]["size"]
        self.aug = cfg["augment"]
        self.neg = cfg.get("negative_class")
        self.cls2idx = {c: i for i, c in enumerate(classes)}
        self.geo = build_geo(self.aug) if train else None
        self.post = build_post(cfg, train)   # para 'composite' y 'bg' (resultado del compositing)
        self.real_tf = build_real(cfg, train)  # para 'real' (fotos con su propio fondo)
        self._cache: dict[str, Image.Image] = {}

    def __len__(self) -> int:
        return len(self.rows)

    def _cutout(self, rel_path: str) -> Image.Image:
        if rel_path not in self._cache:
            self._cache[rel_path] = load_cutout(PROJECT_ROOT / rel_path)
        return self._cache[rel_path]

    def __getitem__(self, i: int):
        row = self.rows[i]
        idx = self.cls2idx[row["label"]]
        # 'mode' decide cómo se construye la imagen (lo fija prepare_dataset). Fallback por
        # compatibilidad: sin path => fondo sintético; con path => recorte para compositing.
        mode = row.get("mode") or ("bg" if not row["path"] else "composite")
        # train: aleatoriedad libre; val/test: determinista por semilla de la fila (métricas estables).
        rng = np.random if self.train else np.random.RandomState(int(row["seed"]))

        if mode == "real":
            # Foto real (data_extra): trae su propio fondo → se usa tal cual, sin compositing.
            img = Image.open(PROJECT_ROOT / row["path"]).convert("RGB")
            return self.real_tf(img), idx
        if mode == "bg":
            # Negativo sintético: solo un fondo procedural, sin producto (doc 09).
            img = make_background((self.size, self.size), rng)
        else:  # 'composite': recorte transparente pegado sobre un fondo procedural (doc 07).
            img = composite(self._cutout(row["path"]), self.size, rng, self.aug, self.train, self.geo)
        return self.post(img), idx


# ─── Manifest + DataLoaders ─────────────────────────────────────────────────
def read_manifest(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _worker_init(worker_id: int) -> None:
    # cada worker (proceso) recibe una semilla distinta → variedad real en train
    s = (torch.initial_seed() + worker_id) % (2**31)
    np.random.seed(s)
    random.seed(s)


def build_dataloaders(cfg: dict, classes: list[str]):
    rows = read_manifest(PROJECT_ROOT / cfg["dataset_dir"] / "manifest.csv")
    by_split = {"train": [], "val": [], "test": []}
    for r in rows:
        by_split[r["split"]].append(r)

    bs = cfg["train"]["batch_size"]
    nw = cfg["train"]["num_workers"]
    common = dict(num_workers=nw, pin_memory=torch.cuda.is_available(),
                  worker_init_fn=_worker_init, persistent_workers=nw > 0)

    train_ds = ProductDataset(by_split["train"], classes, cfg, train=True)
    val_ds = ProductDataset(by_split["val"], classes, cfg, train=False)
    test_ds = ProductDataset(by_split["test"], classes, cfg, train=False)

    train_dl = DataLoader(train_ds, batch_size=bs, shuffle=True, drop_last=False, **common)
    val_dl = DataLoader(val_ds, batch_size=bs, shuffle=False, **common)
    test_dl = DataLoader(test_ds, batch_size=bs, shuffle=False, **common)
    return train_dl, val_dl, test_dl
