// Helpers
const pbkdf2Iterations = 200_000; // reasonable value (slower but safer)
const saltLen = 16;
const ivLen = 12;

function bufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToBuf(b64) {
  const str = atob(b64);
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
  return arr.buffer;
}
function concatBuffers(...buffers) {
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const tmp = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    tmp.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }
  return tmp.buffer;
}

// Derive AES-GCM key from password + salt
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const passKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: pbkdf2Iterations,
      hash: 'SHA-256'
    },
    passKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt API key -> return base64(salt||iv||ciphertext)
async function encryptApiKey(apiKey, password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(saltLen)).buffer;
  const iv = crypto.getRandomValues(new Uint8Array(ivLen)).buffer;
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    enc.encode(apiKey)
  );
  const combined = concatBuffers(salt, iv, ct);
  return bufToBase64(combined);
}

// Decrypt base64(salt||iv||ciphertext) -> returns original apiKey string
async function decryptApiKey(encryptedBase64, password) {
  const combinedBuf = base64ToBuf(encryptedBase64);
  const combined = new Uint8Array(combinedBuf);
  const salt = combined.slice(0, saltLen).buffer;
  const iv = combined.slice(saltLen, saltLen + ivLen).buffer;
  const ct = combined.slice(saltLen + ivLen).buffer;
  const key = await deriveKey(password, salt);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    ct
  );
  return new TextDecoder().decode(plainBuf);
}

// Usage example:
// (async () => {
//   const password = prompt('Enter encryption password (do NOT hardcode in production)');
//   const apiKey = 'my-very-secret-api-key';
//
//   const encrypted = await encryptApiKey(apiKey, password);
//   // Save encrypted to localStorage
//   localStorage.setItem('api_key_enc', encrypted);
//
//   // Later, to read:
//   const stored = localStorage.getItem('api_key_enc');
//   const decrypted = await decryptApiKey(stored, password);
//   console.log('decrypted', decrypted); // original apiKey
// })();
