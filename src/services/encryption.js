'use strict';

const crypto = require('crypto');
const env = require('../config/env');

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Encrypt a JSON object using AES-256-CBC.
 * @param {object} data - plaintext data to encrypt
 * @returns {Buffer} encrypted bytes
 */
function encrypt(data) {
  const key = Buffer.from(env.encryptionKey, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  // Prepend IV to ciphertext
  return Buffer.concat([iv, encrypted]);
}

/**
 * Decrypt AES-256-CBC encrypted bytes back to a JSON object.
 * @param {Buffer} encryptedBuffer - encrypted bytes (IV prepended)
 * @returns {object} decrypted data
 */
function decrypt(encryptedBuffer) {
  const key = Buffer.from(env.encryptionKey, 'hex');
  const iv = encryptedBuffer.subarray(0, IV_LENGTH);
  const ciphertext = encryptedBuffer.subarray(IV_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return JSON.parse(decrypted.toString('utf8'));
}

module.exports = { encrypt, decrypt };
