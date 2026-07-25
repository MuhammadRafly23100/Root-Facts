import * as tf from '@tensorflow/tfjs';
import { setupTfBackend } from '../utils/backend.js';
import { logError, validateModelMetadata } from '../utils/common.js';

// Model Teachable Machine bawaan starter (Layers model) beserta metadata label.
const MODEL_URL = '/model/model.json';
const METADATA_URL = '/model/metadata.json';
const IMAGE_SIZE = 224;

/**
 * DetectionService — memuat model klasifikasi sayuran (Teachable Machine)
 * dan melakukan prediksi pada frame kamera menggunakan TensorFlow.js.
 */
export class DetectionService {
  constructor() {
    this.model = null;
    this.labels = [];
    this.config = null;
    this.backend = null;
  }

  // [Basic] Muat model + metadata bersamaan. [Advance] Backend Adaptive.
  async loadModel(onProgress) {
    // Pilih backend tercepat yang tersedia (WebGPU -> WebGL -> CPU).
    this.backend = await setupTfBackend();

    const [model, metadata] = await Promise.all([
      tf.loadLayersModel(MODEL_URL, {
        onProgress: (fraction) => onProgress?.(Math.round(fraction * 100)),
      }),
      fetch(METADATA_URL).then((res) => {
        if (!res.ok) throw new Error(`Metadata gagal dimuat (${res.status})`);
        return res.json();
      }),
    ]);

    if (!validateModelMetadata(metadata)) {
      throw new Error('Metadata model tidak valid');
    }

    this.model = model;
    this.labels = metadata.labels;
    this.config = metadata;

    // Warm-up: satu prediksi dummy agar shader ter-compile & prediksi pertama cepat.
    tf.tidy(() => {
      const warm = tf.zeros([1, IMAGE_SIZE, IMAGE_SIZE, 3]);
      const out = this.model.predict(warm);
      (Array.isArray(out) ? out : [out]).forEach((t) => t.dataSync());
    });

    return { backend: this.backend, labels: this.labels };
  }

  /**
   * Pra-pemrosesan identik dengan @teachablemachine/image:
   * crop tengah menjadi persegi -> resize 224x224 -> normalisasi ke rentang [-1, 1].
   */
  _preprocess(imageElement) {
    return tf.tidy(() => {
      const pixels = tf.browser.fromPixels(imageElement);
      const [h, w] = pixels.shape;
      const size = Math.min(h, w);
      const top = Math.floor((h - size) / 2);
      const left = Math.floor((w - size) / 2);
      const cropped = pixels.slice([top, left, 0], [size, size, 3]);
      const resized = tf.image.resizeBilinear(cropped, [IMAGE_SIZE, IMAGE_SIZE]);
      const normalized = resized.toFloat().div(127.5).sub(1);
      return normalized.expandDims(0);
    });
  }

  // [Basic] Prediksi pada elemen gambar/video, kembalikan hasil terbaik.
  async predict(imageElement) {
    if (!this.isLoaded()) throw new Error('Model belum dimuat');

    const input = this._preprocess(imageElement);
    let probabilities;
    try {
      const logits = this.model.predict(input);
      probabilities = await logits.data();
      logits.dispose();
    } finally {
      input.dispose();
    }

    // Argmax manual — hindari alokasi tensor tambahan.
    let bestIndex = 0;
    for (let i = 1; i < probabilities.length; i += 1) {
      if (probabilities[i] > probabilities[bestIndex]) bestIndex = i;
    }

    const score = probabilities[bestIndex]; // 0..1 (output softmax TM)
    const confidence = Math.round(score * 100); // 0..100

    return {
      className: this.labels[bestIndex],
      score,
      confidence,
      isValid: true,
    };
  }

  // [Basic] Cek kesiapan model.
  isLoaded() {
    return this.model !== null && this.labels.length > 0;
  }

  dispose() {
    try {
      this.model?.dispose();
    } catch (error) {
      logError('Gagal dispose model deteksi', error);
    }
    this.model = null;
  }
}
