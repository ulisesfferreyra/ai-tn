import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

const DEFAULT_EXPIRATION_SECONDS = Number(process.env.TRYON_URL_EXPIRES_SECONDS || 15 * 60);
const BUCKET = process.env.TRYON_BUCKET_NAME;
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;

if (!BUCKET) {
  // eslint-disable-next-line no-console
  console.warn('[TRY-ON][S3] WARN: TRYON_BUCKET_NAME no está configurado, las subidas fallarán');
}

const s3 = new S3Client({ region: REGION });

function buildKey() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `tryon/${yyyy}/${mm}/${dd}/${randomUUID()}.jpg`;
}

function base64ToBuffer(image) {
  if (!image || typeof image !== 'string') return null;
  const cleaned = image.startsWith('data:image') ? image.split(',')[1] : image;
  try {
    return Buffer.from(cleaned, 'base64');
  } catch (e) {
    return null;
  }
}

export async function uploadAndPresignImage({ imageBase64, contentType = 'image/jpeg', expiresIn = DEFAULT_EXPIRATION_SECONDS }) {
  if (!BUCKET) throw new Error('TRYON_BUCKET_NAME no configurado');
  const body = base64ToBuffer(imageBase64);
  if (!body) throw new Error('Imagen inválida para subir a S3');

  const Key = buildKey();
  const putCmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key,
    Body: body,
    ContentType: contentType,
    ACL: 'private',
  });

  await s3.send(putCmd);

  const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key });
  const url = await getSignedUrl(s3, getCmd, { expiresIn });

  return { key: Key, url };
}
