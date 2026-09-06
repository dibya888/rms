import { BadRequestException, Injectable } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

@Injectable()
export class StorageService {
  private readonly root = process.env.STORAGE_PATH ?? './uploads';
  private readonly bucket = process.env.S3_BUCKET;
  private readonly s3 = this.bucket && process.env.S3_REGION ? new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    } : undefined,
  }) : undefined;

  async saveTenantDocument(ownerId: string, tenantId: string, file: Express.Multer.File) {
    this.validateSignature(file);
    await this.scan(file);
    const extension = file.originalname.includes('.') ? file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase() : '';
    const relativePath = join(ownerId, 'tenants', tenantId, `${randomUUID()}${extension}`);
    if (this.s3 && this.bucket) {
      const key = relativePath.replaceAll('\\', '/');
      await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: file.buffer, ContentType: file.mimetype }));
      return key;
    }
    const absolutePath = join(this.root, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.buffer, { flag: 'wx' });
    return relativePath.replaceAll('\\', '/');
  }

  private validateSignature(file: Express.Multer.File) {
    const signatures: Record<string, (buffer: Buffer) => boolean> = {
      'application/pdf': (buffer) => buffer.subarray(0, 4).toString('ascii') === '%PDF',
      'image/jpeg': (buffer) => buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
      'image/png': (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    };
    if (!signatures[file.mimetype]?.(file.buffer)) throw new BadRequestException('document content does not match its declared type');
  }

  private async scan(file: Express.Multer.File) {
    const scannerUrl = process.env.VIRUS_SCAN_URL;
    if (!scannerUrl) return;
    const response = await fetch(scannerUrl, { method: 'POST', headers: { 'Content-Type': file.mimetype }, body: file.buffer as unknown as BodyInit });
    if (!response.ok) throw new BadRequestException('document virus scan failed');
    const result = await response.json() as { clean?: boolean };
    if (result.clean !== true) throw new BadRequestException('document did not pass virus scanning');
  }
}
