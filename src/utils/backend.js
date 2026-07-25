import * as tf from '@tensorflow/tfjs';
// Registrasi backend WebGPU (opsional) — di-import agar tf.setBackend('webgpu') tersedia.
import '@tensorflow/tfjs-backend-webgpu';
import { isWebGPUSupported, logError } from './common.js';

/**
 * Strategi Backend Adaptive untuk TensorFlow.js.
 * Prioritas: WebGPU -> WebGL -> CPU. Fallback otomatis bila salah satu gagal.
 * Mengembalikan nama backend yang aktif (mis. 'webgpu' | 'webgl' | 'cpu').
 */
export async function setupTfBackend() {
  const order = [];
  if (isWebGPUSupported()) order.push('webgpu');
  order.push('webgl', 'cpu');

  for (const backend of order) {
    try {
      const ok = await tf.setBackend(backend);
      if (!ok) continue;
      await tf.ready();
      return tf.getBackend();
    } catch (error) {
      logError(`Backend ${backend} tidak tersedia`, error);
    }
  }

  // Fallback terakhir — pastikan tf siap dengan backend apa pun yang berhasil.
  await tf.ready();
  return tf.getBackend();
}

/**
 * Pilih device untuk Transformers.js (Generative AI).
 * WebGPU bila tersedia, jika tidak gunakan WASM (berjalan penuh di browser & offline).
 */
export function selectAiDevice() {
  return isWebGPUSupported() ? 'webgpu' : 'wasm';
}
