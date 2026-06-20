"""
export_onnx.py — exporta el mejor checkpoint a ONNX y verifica la equivalencia con PyTorch.

Genera el "bundle" que consume el microservicio de Google Cloud Run:
- outputs/model.onnx          (modelo, batch dinámico)
- outputs/labels.json         (índice → SKU; "otros" = clase negativa / rechazo)
- outputs/inference_meta.json (tamaño, normalización, umbral, salida = logits)

Uso:  python export_onnx.py
"""
from __future__ import annotations

import numpy as np
import torch

from utils import (PROJECT_ROOT, build_model, class_list, get_device, load_config, save_json)


def main() -> None:
    cfg = load_config()
    device = get_device()
    classes = class_list(cfg)
    out_dir = PROJECT_ROOT / cfg["outputs_dir"]
    ckpt_path = out_dir / "best.pt"
    if not ckpt_path.exists():
        raise SystemExit("[ERROR] No existe outputs/best.pt. Corre primero train.py.")

    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    size = int(ckpt["img_size"])
    model = build_model(ckpt["model_name"], len(classes), pretrained=False)
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    onnx_path = out_dir / cfg["onnx"]["filename"]
    dummy = torch.randn(1, 3, size, size)
    torch.onnx.export(
        model, (dummy,), str(onnx_path),
        input_names=["input"], output_names=["logits"],
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=int(cfg["onnx"]["opset"]),
        do_constant_folding=True, dynamo=False,
    )
    print(f"[OK] Exportado: {onnx_path.relative_to(PROJECT_ROOT)}")

    # --- Verificación numérica contra PyTorch -------------------------------
    try:
        import onnxruntime as ort

        # Filtra a CUDA/CPU: evita el ruido de TensorRT (onnxruntime-gpu lo lista aunque falte el DLL).
        avail = ort.get_available_providers()
        providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in avail] \
            or ["CPUExecutionProvider"]
        sess = ort.InferenceSession(str(onnx_path), providers=providers)
        with torch.no_grad():
            torch_out = model(dummy).numpy()
        ort_out = sess.run(None, {"input": dummy.numpy()})[0]
        max_diff = float(np.abs(torch_out - ort_out).max())
        ok = max_diff < 1e-3
        print(f"[{'OK' if ok else 'AVISO'}] Verificacion ONNX vs PyTorch · "
              f"max|diff|={max_diff:.2e}  (providers={providers})")
    except Exception as e:  # noqa: BLE001
        max_diff, ok = None, None
        print(f"[AVISO] No se pudo verificar con onnxruntime: {e}")

    # --- Bundle para el servicio de inferencia ------------------------------
    save_json({str(i): c for i, c in enumerate(classes)}, out_dir / "labels.json")
    save_json({
        "model_name": ckpt["model_name"],
        "input_size": size,
        "channels_order": "RGB",
        "normalize_mean": cfg["image"]["mean"],
        "normalize_std": cfg["image"]["std"],
        "output": "logits (aplicar softmax en el servicio)",
        "confidence_threshold": cfg["inference"]["confidence_threshold"],
        "negative_class": cfg.get("negative_class"),
        "classes": classes,
        "onnx_opset": int(cfg["onnx"]["opset"]),
        "verification_max_abs_diff": max_diff,
    }, out_dir / "inference_meta.json")
    print(f"[OK] Bundle de inferencia en {out_dir.relative_to(PROJECT_ROOT)}/ "
          "(model.onnx, labels.json, inference_meta.json)")


if __name__ == "__main__":
    main()
