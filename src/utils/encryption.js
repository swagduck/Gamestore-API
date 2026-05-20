const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(
  process.env.MESSAGE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex').slice(0, 64),
  'hex'
);

/**
 * Mã hóa nội dung tin nhắn
 * @param {string} plaintext
 * @returns {string} "iv:authTag:ciphertext" (base64)
 */
const encrypt = (plaintext) => {
  const iv = crypto.randomBytes(12); // 96-bit IV cho GCM
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Ghép iv + authTag + ciphertext thành 1 chuỗi base64
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
};

/**
 * Giải mã nội dung tin nhắn
 * @param {string} encryptedStr "iv:authTag:ciphertext"
 * @returns {string} plaintext
 */
const decrypt = (encryptedStr) => {
  try {
    const [ivB64, authTagB64, ciphertextB64] = encryptedStr.split(':');
    if (!ivB64 || !authTagB64 || !ciphertextB64) return encryptedStr; // chuỗi cũ chưa mã hóa
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
  } catch (e) {
    // Nếu giải mã lỗi (tin nhắn cũ plaintext) → trả về nguyên bản
    return encryptedStr;
  }
};

module.exports = { encrypt, decrypt };
