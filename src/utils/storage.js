import { logError } from './common.js';

/**
 * Meminta penyimpanan persisten ke browser.
 *
 * Penting untuk perangkat mobile: tanpa ini, browser boleh membuang isi Cache
 * Storage kapan saja saat kuota tertekan (best-effort eviction). Karena aplikasi
 * menyimpan model TensorFlow + model Generative AI yang besar, cache bisa terusir
 * sehingga aplikasi gagal berjalan offline. Dengan izin persisten, data hanya
 * terhapus bila pengguna sendiri yang menghapusnya.
 */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;

  try {
    // Jangan minta ulang bila sudah persisten.
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (error) {
    logError('Gagal meminta penyimpanan persisten', error);
    return false;
  }
}

/**
 * Perkiraan pemakaian kuota penyimpanan (byte), untuk diagnosis.
 */
export async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  } catch (error) {
    logError('Gagal membaca estimasi penyimpanan', error);
    return null;
  }
}
