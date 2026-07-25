import { pipeline, env } from '@huggingface/transformers';
import { TONE_CONFIG } from '../utils/config.js';
import { selectAiDevice } from '../utils/backend.js';
import { logError } from '../utils/common.js';

// Model Generative AI ringan (instruction-tuned T5) — berjalan penuh di browser
// via Transformers.js, sehingga tetap bisa dipakai saat offline setelah ter-cache.
const MODEL_NAME = 'Xenova/LaMini-Flan-T5-77M';
const TASK = 'text2text-generation';
const MAX_NEW_TOKENS = 150; // batasi output ±150 token sesuai ketentuan.

// Petunjuk gaya (persona) dalam Bahasa Inggris untuk tiap tone pada TONE_CONFIG.
const TONE_STYLES = {
  normal: 'in a clear and informative tone',
  funny: 'in a funny and playful tone with light humor',
  professional: 'in a formal, scientific, and professional tone',
  casual: 'in a relaxed, friendly, and casual tone',
  kids: 'in a simple, cheerful tone that a young child can easily understand',
  chef: 'from the perspective of a passionate chef, mentioning taste or cooking',
  nutritionist: 'from the perspective of a nutritionist, focusing on health benefits',
};

/**
 * RootFactsService — menghasilkan "fun fact" tentang sayuran hasil deteksi
 * menggunakan Generative AI (Transformers.js). Mendukung pemilihan tone.
 */
export class RootFactsService {
  constructor() {
    this.generator = null;
    this.isModelLoaded = false;
    this.isGenerating = false;
    this.config = null;
    this.currentBackend = null;
    this.currentTone = TONE_CONFIG.defaultTone;
  }

  // [Basic] Inisialisasi pipeline text2text-generation. [Advance] Backend Adaptive.
  async loadModel(onProgress) {
    // WASM di-cache secara lokal oleh Transformers.js; izinkan unduh model dari HF Hub
    // pada run pertama, selanjutnya dilayani dari cache (Service Worker / browser cache).
    env.allowLocalModels = false;

    this.currentBackend = selectAiDevice(); // 'webgpu' | 'wasm'

    this.generator = await pipeline(TASK, MODEL_NAME, {
      device: this.currentBackend,
      // Kuantisasi 4-bit: unduhan jauh lebih kecil & inferensi lebih ringan
      // dibanding versi full-precision (sesuai anjuran tips submission).
      dtype: 'q4',
      progress_callback: (data) => {
        if (data?.status === 'progress' && typeof data.progress === 'number') {
          onProgress?.(Math.round(data.progress));
        }
      },
    });

    this.isModelLoaded = true;
    return { backend: this.currentBackend };
  }

  // [Advance] Simpan tone yang dipilih pengguna.
  setTone(tone) {
    if (TONE_STYLES[tone]) {
      this.currentTone = tone;
    }
    return this.currentTone;
  }

  // Bangun prompt Bahasa Inggris sesuai tone aktif.
  _buildPrompt(vegetableName) {
    const style = TONE_STYLES[this.currentTone] || TONE_STYLES.normal;
    return (
      `Write one short and interesting fun fact about the vegetable named "${vegetableName}" ` +
      `${style}. Use simple English and keep it under three sentences.`
    );
  }

  // [Basic] Hasilkan fun fact. [Skilled] Parameter generasi. [Advance] Terapkan tone.
  async generateFacts(vegetableName) {
    if (!this.isReady()) throw new Error('Model AI belum siap');

    this.isGenerating = true;
    try {
      const output = await this.generator(this._buildPrompt(vegetableName), {
        max_new_tokens: MAX_NEW_TOKENS,
        temperature: 0.7,
        top_p: 0.9,
        do_sample: true,
        repetition_penalty: 1.3,
      });

      const text = Array.isArray(output)
        ? output[0]?.generated_text
        : output?.generated_text;

      return (text || '').trim();
    } catch (error) {
      logError('Gagal menghasilkan fun fact', error);
      throw error;
    } finally {
      this.isGenerating = false;
    }
  }

  // [Basic] Cek kesiapan model AI.
  isReady() {
    return this.isModelLoaded && this.generator !== null;
  }
}
