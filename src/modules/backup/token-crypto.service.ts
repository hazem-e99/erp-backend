import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ALGO = 'aes-256-gcm';

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

@Injectable()
export class TokenCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const raw = config.get<string>('BACKUP_ENCRYPTION_KEY');
    if (!raw) {
      throw new InternalServerErrorException(
        'BACKUP_ENCRYPTION_KEY is required (64 hex chars / 32 bytes)',
      );
    }
    // Accept hex (64 chars) or base64; otherwise derive via scrypt for convenience.
    if (/^[0-9a-f]{64}$/i.test(raw)) {
      this.key = Buffer.from(raw, 'hex');
    } else {
      const buf = Buffer.from(raw, 'base64');
      this.key = buf.length === 32 ? buf : crypto.scryptSync(raw, 'erp-backup', 32);
    }
  }

  encrypt(plaintext: string): EncryptedPayload {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: ct.toString('base64'),
      iv: iv.toString('base64'),
      authTag: tag.toString('base64'),
    };
  }

  decrypt(payload: EncryptedPayload): string {
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.authTag, 'base64');
    const ct = Buffer.from(payload.ciphertext, 'base64');
    const decipher = crypto.createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }
}
