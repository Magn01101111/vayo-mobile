import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const requiredFiles = [
  'ia_related/outputs/model.onnx',
  'ia_related/outputs/inference_meta.json',
  'ia_related/outputs/labels.json',
];

const missing = [];

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(repoRoot, relativePath);
  try {
    await access(absolutePath);
  } catch {
    missing.push(relativePath);
  }
}

if (missing.length > 0) {
  console.error('[verify-ml-assets] Faltan archivos del bundle ONNX requerido para la inferencia local.');
  console.error('[verify-ml-assets] Archivos faltantes:');
  for (const relativePath of missing) {
    console.error(`  - ${relativePath}`);
  }
  console.error('[verify-ml-assets] Genera nuevamente ia_related/outputs ejecutando el pipeline de IA y luego recompila la app.');
  console.error('[verify-ml-assets] Flujo esperado: prepare_dataset.py -> train.py -> evaluate.py -> export_onnx.py');
  process.exit(1);
}

console.log('[verify-ml-assets] Bundle ONNX encontrado.');
