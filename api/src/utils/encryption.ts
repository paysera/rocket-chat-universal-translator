import crypto from 'crypto';

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 64; // 512 bits

// Get encryption key from environment or generate one
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    console.warn('ENCRYPTION_KEY not set in environment. Using default key (NOT SECURE FOR PRODUCTION)');
    return crypto.scryptSync('default-key-change-in-production', 'salt', KEY_LENGTH);
  }
  
  // If key is provided as hex string
  if (key.length === KEY_LENGTH * 2) {
    return Buffer.from(key, 'hex');
  }
  
  // Otherwise derive key from passphrase
  return crypto.scryptSync(key, 'universal-translator-salt', KEY_LENGTH);
}

// Encrypt API key or sensitive data
export function encryptApiKey(apiKey: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Combine iv:authTag:encrypted for storage
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

// Decrypt API key or sensitive data
export function decryptApiKey(encryptedData: string): string {
  try {
    const key = getEncryptionKey();
    const parts = encryptedData.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
}

// Hash sensitive data for comparison (one-way)
export function hashData(data: string): string {
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex');
}

// Generate secure random API key
export function generateApiKey(prefix: string = 'ut'): string {
  const randomBytes = crypto.randomBytes(32);
  const timestamp = Date.now().toString(36);
  const key = randomBytes.toString('base64')
    .replace(/[+/=]/g, '') // Remove special characters
    .substring(0, 32);
  
  return `${prefix}_${timestamp}_${key}`;
}

// Generate secure random token
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

// Encrypt JSON object
export function encryptJson(obj: any): string {
  const jsonString = JSON.stringify(obj);
  return encryptApiKey(jsonString);
}

// Decrypt JSON object
export function decryptJson(encryptedData: string): any {
  const jsonString = decryptApiKey(encryptedData);
  return JSON.parse(jsonString);
}

// Hash password with salt (for user authentication if needed)
export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_LENGTH);
    
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derivedKey) => {
      if (err) {
        reject(err);
      } else {
        resolve(`${salt.toString('hex')}:${derivedKey.toString('hex')}`);
      }
    });
  });
}

// Verify password hash
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(':');
    
    crypto.pbkdf2(password, Buffer.from(salt, 'hex'), 100000, 64, 'sha512', (err, derivedKey) => {
      if (err) {
        reject(err);
      } else {
        resolve(key === derivedKey.toString('hex'));
      }
    });
  });
}

// Create HMAC signature for webhook validation
export function createHmacSignature(data: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex');
}

// Verify HMAC signature
export function verifyHmacSignature(data: string, signature: string, secret: string): boolean {
  const expectedSignature = createHmacSignature(data, secret);
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Mask sensitive data for logging
export function maskSensitiveData(data: string, visibleChars: number = 4): string {
  if (data.length <= visibleChars * 2) {
    return '*'.repeat(data.length);
  }
  
  const start = data.substring(0, visibleChars);
  const end = data.substring(data.length - visibleChars);
  const masked = '*'.repeat(Math.max(8, data.length - visibleChars * 2));
  
  return `${start}${masked}${end}`;
}

// Export encryption key generator for setup
export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}