import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { CloudProvider } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { prisma } from "./db";
import { signFileQuery } from "./file-links";
import { get } from "http";
import { publicBase } from "@/lib/urls";

//Proper way to do this in the future would be to have separate modules for each storage type
// and then have this file orchestrate which one to use based on config.
// Simmilar to https://refactoring.guru/design-patterns/strategy

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

// Storage configuration
const STORAGE_MODE = process.env.STORAGE_MODE || "hybrid"; // 'local', 's3', 'hybrid'
const LOCAL_STORAGE_PATH =
  process.env.LOCAL_STORAGE_PATH || "/var/www/ai_docusign_clone/uploads";
const ENABLE_S3_BACKUP = process.env.ENABLE_S3_BACKUP !== "false"; // Default true for hybrid
const SERVING_PATH = publicBase();

// S3 configuration
const s3Enabled =
  STORAGE_MODE === "s3" || (STORAGE_MODE === "hybrid" && ENABLE_S3_BACKUP);
let s3Client: S3Client | null = null;
let bucketName: string = "";
let folderPrefix: string = "";

if (s3Enabled && process.env.AWS_BUCKET_NAME) {
  s3Client = new S3Client({
    region: process.env.AWS_REGION,
    // Any S3-compatible store (MinIO, Garage, Ceph…): its address, with path-style bucket URLs.
    ...(process.env.AWS_ENDPOINT_URL ? { endpoint: process.env.AWS_ENDPOINT_URL, forcePathStyle: true } : {}),
    ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
  bucketName = process.env.AWS_BUCKET_NAME || "";
  folderPrefix = process.env.AWS_FOLDER_PREFIX || "";
}

// Get storage prefix based on provider
export function getStoragePrefix(provider: CloudProvider): string {
  switch (provider) {
    case CloudProvider.LOCAL:
      return LOCAL_STORAGE_PATH;
    case CloudProvider.AWS:
      return `s3://${bucketName}/${folderPrefix}`;
    case CloudProvider.AZURE:
    case CloudProvider.GOOGLE:
    default:
      throw Error("❌ Currently unsupported cloud provider for storage prefix");
  }
}

//Resolves the appropriate storage directories based on type
export async function getStorageDir(
  filePath: string,
  provider: CloudProvider,
): Promise<{ path: string }> {
  console.log(
    `Resolving storage dir for provider: ${provider}, filePath: ${filePath}`,
  );
  switch (provider) {
    case CloudProvider.LOCAL:
      let res = path.join(getStoragePrefix(provider), filePath);
      return { path: res };
    case CloudProvider.AWS:
      // WARNING: Untested path - ensure S3Client is configured
      return { path: `${folderPrefix}${filePath}` };
    case CloudProvider.AZURE:
    case CloudProvider.GOOGLE:
    default:
      throw Error(
        "❌ Currently unsupported cloud provider for storage directory",
      );
  }
}

/**
 * Resolves a storage path to a browser-accessible URL
 *
 * WHY THIS EXISTS & WHY THERE'S NO /api/files/documents/ FOLDER:
 * ================================================================
 * Next.js uses DYNAMIC ROUTING with [...path] catch-all segments.
 * The route at app/api/files/[...path]/route.ts matches ANY path after /api/files/:
 *
 *   /api/files/documents/file.pdf       → params.path = ["documents", "file.pdf"]
 *   /api/files/templates/template.pdf   → params.path = ["templates", "template.pdf"]
 *   /api/files/any/nested/path.pdf      → params.path = ["any", "nested", "path.pdf"]
 *
 * There is NO physical "documents" folder under app/api/files/ - it's a DYNAMIC route!
 * The [...path] parameter captures all URL segments, and the route handler (route.ts)
 * uses them to locate the actual file in the filesystem at LOCAL_STORAGE_PATH.
 *
 * This function converts storage paths (relative file paths like "documents/file.pdf")
 * into HTTP URLs that browsers can request ("/api/files/documents/file.pdf"), which
 * Next.js will route to app/api/files/[...path]/route.ts for serving.
 *
 * @param filePath - Relative storage path (e.g., "documents/filename.pdf")
 * @param provider - Cloud provider enum (LOCAL, AWS, etc.)
 * @returns Browser-accessible URL (for LOCAL: "/api/files/documents/filename.pdf")
 */
export async function getServingLocation(
  filePath: string,
  provider: CloudProvider,
): Promise<string> {
  switch (provider) {
    case CloudProvider.LOCAL:
      // For local storage, construct API route URL
      // The /api/files/[...path] route will handle this and serve from LOCAL_STORAGE_PATH
      return `/api/files/${filePath}`;

    case CloudProvider.AWS:
      // WARNING: Untested path - ensure S3Client is configured
      return await getS3SignedUrl(filePath);

    case CloudProvider.AZURE:
    case CloudProvider.GOOGLE:
    default:
      throw Error(
        "❌ Currently unsupported cloud provider for serving location",
      );
  }
}

// Gets the raw storage path and provider for a given file ID, may not be it's actual location
export async function getDocPathById(
  fileId: string,
): Promise<{ storagePath: string; provider: CloudProvider }> {
  const res = await prisma.document.findUnique({
    where: { id: fileId },
    select: { cloudStoragePath: true, cloudProvider: true },
  });

  if (!res) {
    throw new Error("File not found in database");
  }

  return { storagePath: res.cloudStoragePath, provider: res.cloudProvider };
}

//Finds the actual storage path based on file ID
export async function resolveStoragePathById(
  fileId: string,
): Promise<{ storagePath: string; provider: CloudProvider }> {
  const { storagePath, provider } = await getDocPathById(fileId);
  return {
    storagePath: (await getStorageDir(storagePath, provider)).path,
    provider,
  };
}

// Ensure local storage directory exists
async function ensureLocalStorageDir() {
  try {
    await mkdir(LOCAL_STORAGE_PATH, { recursive: true });
    await mkdir(path.join(LOCAL_STORAGE_PATH, "documents"), {
      recursive: true,
    });
    await mkdir(path.join(LOCAL_STORAGE_PATH, "templates"), {
      recursive: true,
    });
  } catch (error) {
    console.error("Error creating storage directories:", error);
  }
}

ensureLocalStorageDir();

/**
 * Upload a file with hybrid storage support
 * - Always saves locally
 * - Optionally backs up to S3
 */
export async function uploadFile(
  buffer: Buffer,
  fileName: string,
  fileType: "documents" | "templates" = "documents",
): Promise<string> {
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const localFileName = `${timestamp}-${sanitizedFileName}`;
  const localFilePath = path.join(LOCAL_STORAGE_PATH, fileType, localFileName);
  const storageKey = `${fileType}/${localFileName}`;

  try {
    // Always save locally first
    await writeFile(localFilePath, buffer);
    console.log(`File saved locally: ${localFilePath}`);

    // If hybrid mode and S3 is enabled, backup to S3
    if (STORAGE_MODE === "hybrid" && s3Client && ENABLE_S3_BACKUP) {
      try {
        const s3Key = `${folderPrefix}${storageKey}`;
        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
          Body: buffer,
          ContentType: getContentType(fileName),
        });
        await s3Client.send(command);
        console.log(`File backed up to S3: ${s3Key}`);
      } catch (s3Error) {
        console.error("S3 backup failed, but local file saved:", s3Error);
        // Don't fail the upload if S3 backup fails
      }
    }

    // Return the local storage key
    return storageKey;
  } catch (error) {
    console.error("File upload error:", error);
    throw new Error("Failed to upload file");
  }
}

/**
 * Get file download URL or path
 * - For local storage, returns the local file path
 * - For S3-only, returns signed URL
 * - For hybrid, returns local path (with S3 fallback)
 * @param storagePath - The file path in storage
 * @param provider - Storage provider (LOCAL, AWS, etc.)
 * @param expiresIn - Expiry time in seconds (default: 300 for 5 minutes)
 */
export async function getFileDownloadUrl(
  storagePath: string,
  provider: CloudProvider,
  expiresIn: number = 300,
): Promise<string> {
  switch (provider) {
    case CloudProvider.LOCAL: {
      // For local storage, return the API route URL (because relative path works better with PDF.js),
      // signed so it also opens for a signer who has no account (lib/file-links).
      const clean = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");
      return `/api/files/${clean}?${signFileQuery(clean, expiresIn)}`;
    }
    case CloudProvider.AWS:
      // For S3, return a signed URL with custom expiry
      return await getS3SignedUrl(storagePath, expiresIn);
    case CloudProvider.AZURE:
    case CloudProvider.GOOGLE:
    default:
      throw Error(
        "❌ Currently unsupported cloud provider for serving location",
      );
  }
}

/**
 * Get file buffer (for direct file serving)
 */
export async function getFileBuffer(
  storagePath: string,
  provider: CloudProvider,
): Promise<Buffer> {
  switch (provider) {
    case CloudProvider.LOCAL:
      // Local storage handling (default)
      const localFilePath = path.join(
        process.env.LOCAL_STORAGE_PATH ?? "",
        storagePath,
      );
      console.log("Fetching file from local storage:", localFilePath);
      if (fs.existsSync(localFilePath)) {
        return await readFile(localFilePath);
      }
      throw new Error("File not found in local storage");
    case CloudProvider.AWS:
      // WARNING: Untested path - ensure S3Client is configured
      return await getFileFromS3(storagePath);
    case CloudProvider.AZURE:
    case CloudProvider.GOOGLE:
    default:
      throw Error("❌ Currently unsupported cloud provider for file retrieval");
  }
}

/**
 * Delete a file from storage
 */
export async function deleteFile(
  storagePath: string,
  provider: CloudProvider,
): Promise<void> {
  switch (provider) {
    case CloudProvider.LOCAL:
      // Local storage handling (default)
      const localFilePath = (await getStorageDir(storagePath, provider)).path;
      console.log("Deleting file from local storage:", localFilePath);
      await unlink(localFilePath);
      return;
    case CloudProvider.AWS:
      // WARNING: Untested path - ensure S3Client is configured
      try {
        const s3Key = `${folderPrefix}${storagePath}`;
        const command = new DeleteObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
        });
        if (!s3Client) throw new Error("S3 not configured");
        await s3Client.send(command);
        console.log(`File deleted from S3: ${s3Key}`);
        return;
      } catch (error) {
        console.error("Error deleting S3 file:", error);
        throw error;
      }
    case CloudProvider.AZURE:
    case CloudProvider.GOOGLE:
    default:
      throw Error("❌ Currently unsupported cloud provider for file deletion");
  }
}

/**
 * Copy a file from one storage location to another
 */
export async function copyFile(
  sourceStoragePath: string,
  destStoragePath: string,
  provider: CloudProvider,
): Promise<void> {
  console.log(`Copying file from ${sourceStoragePath} to ${destStoragePath}`);

  // Get the source file buffer
  const fileBuffer = await getFileBuffer(sourceStoragePath, provider);

  // Write to destination
  switch (provider) {
    case CloudProvider.LOCAL:
      const destDir = path.dirname(path.join(LOCAL_STORAGE_PATH, destStoragePath));
      await mkdir(destDir, { recursive: true });
      const destFilePath = path.join(LOCAL_STORAGE_PATH, destStoragePath);
      await writeFile(destFilePath, fileBuffer);
      console.log(`File copied to local storage: ${destFilePath}`);
      return;
    case CloudProvider.AWS:
      if (!s3Client) throw new Error("S3 not configured");
      const s3Key = `${folderPrefix}${destStoragePath}`;
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: fileBuffer,
      });
      await s3Client.send(command);
      console.log(`File copied to S3: ${s3Key}`);
      return;
    case CloudProvider.AZURE:
    case CloudProvider.GOOGLE:
    default:
      throw Error("❌ Currently unsupported cloud provider for file copy");
  }
}

// Helper functions
async function getS3SignedUrl(
  storagePath: string,
  expiresIn: number = 3600,
): Promise<string> {
  if (!s3Client) throw new Error("S3 not configured");

  const s3Key = `${folderPrefix}${storagePath}`;
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
}

async function getFileFromS3(storagePath: string): Promise<Buffer> {
  if (!s3Client) throw new Error("S3 not configured");

  const s3Key = `${folderPrefix}${storagePath}`;
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
  });

  const response = await s3Client.send(command);
  const stream = response.Body as any;

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

export function getContentType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
  };

  return contentTypes[ext || ""] || "application/octet-stream";
}

export function getStorageInfo() {
  return {
    mode: STORAGE_MODE,
    localPath: LOCAL_STORAGE_PATH,
    s3Enabled: s3Enabled,
    s3Bucket: bucketName || "not configured",
    backupEnabled: ENABLE_S3_BACKUP,
  };
}
// Add this near the bottom of lib/storage.ts
export async function getFileFromStorage(filePath: string) {
  // Hybrid storage logic
  // Adjust based on your existing storage system (local/S3/hybrid)
  if (process.env.STORAGE_MODE === "s3") {
    const { getS3File } = await import("./s3");
    return await getS3File(filePath);
  } else {
    // Default local
    const fs = await import("fs/promises");
    const fullPath = `${process.env.LOCAL_STORAGE_PATH}/${filePath}`;
    return await fs.readFile(fullPath);
  }
}
// keep near the bottom of lib/storage.ts
export async function getFile(filePath: string): Promise<Buffer> {
  return await getFileFromStorage(filePath);
}
