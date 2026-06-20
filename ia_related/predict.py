"""
predict.py — clasifica imágenes sueltas (fotos reales) con el modelo entrenado.

A diferencia de evaluate.py (que mide sobre el test sintético), esto sirve para probar
generalización con fotos REALES: una imagen -> SKU + confianza, aplicando el umbral de rechazo.

Uso:
    python predict.py                       # carpeta test_real/ con best.pt
    python predict.py <carpeta>             # clasifica todas las imágenes de una carpeta
    python predict.py <imagen.jpg>          # una sola imagen
    python predict.py <carpeta> last        # usa last.pt en vez de best.pt

Nota: NO hace compositing (las fotos reales ya traen su fondo). Redimensiona la imagen
completa al tamaño del modelo para no recortar el producto.
"""
from __future__ import annotations

import sys
from pathlib import Path

import torch
import torchvision.transforms as T
from PIL import Image

from utils import PROJECT_ROOT, build_model, get_device, load_config

IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def collect(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    if path.is_dir():
        return sorted(p for p in path.iterdir() if p.suffix.lower() in IMG_EXT)
    raise SystemExit(f"[ERROR] No existe: {path}")


def main() -> None:
    cfg = load_config()
    device = get_device()
    out_dir = PROJECT_ROOT / cfg["outputs_dir"]
    # 2º argumento opcional: "best" (def.) o "last" para elegir el checkpoint.
    which = sys.argv[2] if len(sys.argv) > 2 else "best"
    ckpt_name = "last.pt" if which.startswith("last") else "best.pt"
    ckpt_path = out_dir / ckpt_name
    if not ckpt_path.exists():
        raise SystemExit(f"[ERROR] No existe outputs/{ckpt_name}. Corre primero train.py.")

    ckpt = torch.load(ckpt_path, map_location=device, weights_only=False)
    classes = ckpt["classes"]
    size = int(ckpt["img_size"])
    neg = cfg.get("negative_class")
    thr = float(cfg["inference"]["confidence_threshold"])

    model = build_model(ckpt["model_name"], len(classes), pretrained=False).to(device)
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    tf = T.Compose([T.Resize((size, size)), T.ToTensor(),
                    T.Normalize(ckpt["mean"], ckpt["std"])])

    arg = sys.argv[1] if len(sys.argv) > 1 else "test_real"
    target = Path(arg) if Path(arg).is_absolute() else (PROJECT_ROOT / arg)
    files = collect(target)
    if not files:
        raise SystemExit(f"[ERROR] No hay imágenes en: {target}")

    prod_idx = 0  # la primera clase es el SKU real (orden: SKUs + 'otros')
    print(f"\nCheckpoint: {ckpt_name}  | modelo: {ckpt['model_name']}  | clases: {classes}  | umbral: {thr}")
    print(f"Imágenes: {len(files)}  (carpeta: {target.name})\n")
    print(f"{'archivo':52s} {'predicción':18s} {'conf':>6} {'P(SKU)':>7}  veredicto")
    print("-" * 104)

    accepted = 0
    with torch.no_grad():
        for f in files:
            img = Image.open(f).convert("RGB")
            x = tf(img).unsqueeze(0).to(device)
            probs = torch.softmax(model(x), dim=1)[0].cpu()
            top = int(probs.argmax())
            conf = float(probs[top])
            p_sku = float(probs[prod_idx])
            pred = classes[top]

            if pred == neg or conf < thr:
                verdict = "NO reconocido"
            else:
                verdict = f"-> {pred}"
                accepted += 1
            name = f.name if len(f.name) <= 50 else f.name[:47] + "..."
            print(f"{name:52s} {pred:18s} {conf:6.3f} {p_sku:7.3f}  {verdict}")

    print("-" * 104)
    print(f"Reconocidas como el producto (conf >= {thr}): {accepted}/{len(files)}")
    print("Nota: P(SKU) es la probabilidad de la clase del producto, independiente del umbral.")


if __name__ == "__main__":
    main()
