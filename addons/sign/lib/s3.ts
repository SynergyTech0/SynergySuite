import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Client, getBucketConfig } from "./aws-config";

// ✅ Initialize S3 client and configuration
const s3Client = createS3Client();
const { bucketName, folderPrefix } = getBucketConfig();

/**
 * Upload a file buffer to S3
 */
export async function uploadFile(buffer: Buffer, fileName: string): Promise<string> {
  const key = `${folderPrefix}documents/${Date.now()}-${sanitizeFileName(fileName)}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: getContentType(fileName),
  });

  await s3Client.send(command);
  console.log(`[S3] Uploaded: ${key}`);
  return key;
}

/**
 * Generate a signed URL for downloading a file
 * @param cloudStoragePath - The S3 key/path
 * @param expiresIn - Expiry time in seconds (default: 300 for 5 minutes)
 */
export async function getFileDownloadUrl(cloudStoragePath: string, expiresIn: number = 300): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: cloudStoragePath,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Delete a file from S3
 */
export async function deleteFile(cloudStoragePath: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: cloudStoragePath,
  });

  await s3Client.send(command);
  console.log(`[S3] Deleted: ${cloudStoragePath}`);
}

/**
 * Get a file from S3 as Buffer
 * (Used by getFileFromStorage() in lib/storage.ts)
 */
export async function getS3File(filePath: string): Promise<Buffer> {
  const s3Key = `${folderPrefix}${filePath}`;
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
  });

  const response = await s3Client.send(command);
  const stream = response.Body as any;

  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);

  const data = Buffer.concat(chunks);
  console.log(`[S3] Fetched: ${s3Key} (${data.length} bytes)`);
  return data;
}

/**
 * Helper — Determine MIME type based on file extension
 */
function getContentType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    json: "application/json",
  };

  return contentTypes[ext || ""] || "application/octet-stream";
}

/**
 * Helper — Sanitize filenames for S3-safe keys
 */
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}
