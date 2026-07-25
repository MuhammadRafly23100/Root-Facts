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

  /**
   * Bangun prompt Bahasa Inggris sesuai tone aktif.
   * Nama sayuran hasil klasifikasi disebut berulang dan diberi batasan eksplisit
   * agar model tidak melantur ke sayuran lain.
   */
  _buildPrompt(vegetableName) {
    const style = TONE_STYLES[this.currentTone] || TONE_STYLES.normal;
    return (
      `Give one interesting and accurate fun fact about ${vegetableName}. ` +
      `The fact must be about ${vegetableName} only and must not mention any other vegetable. ` +
      `Answer ${style}, in one or two short sentences of simple English.`
    );
  }

  // Ambil teks dari keluaran pipeline (bentuknya bisa array atau objek tunggal).
  static _extractText(output) {
    const text = Array.isArray(output) ? output[0]?.generated_text : output?.generated_text;
    return (text || '').trim();
  }

  // Periksa apakah hasil benar-benar menyebut sayuran yang terdeteksi.
  static _mentions(text, vegetableName) {
    return text.toLowerCase().includes(vegetableName.toLowerCase());
  }

  // [Basic] Hasilkan fun fact. [Skilled] Parameter generasi. [Advance] Terapkan tone.
  async generateFacts(vegetableName) {
    if (!this.isReady()) throw new Error('Model AI belum siap');

    const prompt = this._buildPrompt(vegetableName);
    this.isGenerating = true;

    try {
      // Sampling terkendali: temperature & top_p rendah agar keluaran tetap
      // fokus pada konteks (nilai tinggi membuat teks acak dan menyimpang).
      let text = RootFactsService._extractText(
        await this.generator(prompt, {
          max_new_tokens: MAX_NEW_TOKENS,
          temperature: 0.3,
          top_p: 0.7,
          do_sample: true,
          // Dijaga rendah: penalti tinggi ikut menghukum pengulangan nama
          // sayuran itu sendiri, sehingga model malah membahas sayuran lain.
          repetition_penalty: 1.05,
        }),
      );

      // Bila hasil tidak menyebut sayuran yang terdeteksi, ulangi sekali dengan
      // decoding deterministik (greedy) supaya jawaban tetap pada konteks.
      if (!RootFactsService._mentions(text, vegetableName)) {
        text = RootFactsService._extractText(
          await this.generator(prompt, {
            max_new_tokens: MAX_NEW_TOKENS,
            do_sample: false,
            repetition_penalty: 1.05,
          }),
        );
      }

      return text;
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
