# Hybrid Storage Setup Guide for SynergySign

## Overview

SynergySign now supports **hybrid storage** that combines local server storage with optional S3 backup. This gives you the best of both worlds:

- **Fast Local Access**: Files are stored on your server for quick retrieval
- **Cloud Backup**: Automatic backup to S3 for redundancy and disaster recovery
- **Flexible Configuration**: Choose between local-only, S3-only, or hybrid mode

## Storage Modes

### 1. Hybrid Mode (Recommended)
Files are stored locally first, then automatically backed up to S3.

```env
STORAGE_MODE=hybrid
LOCAL_STORAGE_PATH=/home/ubuntu/ai_docusign_clone/nextjs_space/uploads
ENABLE_S3_BACKUP=true
```

**How it works:**
- ✅ Files saved locally immediately
- ✅ Automatic S3 backup happens in background
- ✅ Files served from local storage (fast)
- ✅ S3 fallback if local file is missing
- ✅ Upload succeeds even if S3 backup fails

### 2. Local-Only Mode
Files stored only on your server (no S3).

```env
STORAGE_MODE=local
LOCAL_STORAGE_PATH=/home/ubuntu/ai_docusign_clone/nextjs_space/uploads
```

**Use case:** Development, testing, or if you don't need cloud backup.

### 3. S3-Only Mode
Files stored only in S3 (original behavior).

```env
STORAGE_MODE=s3
AWS_BUCKET_NAME=your-bucket-name
AWS_REGION=us-east-1
```

**Use case:** If you want to use S3 exclusively without local storage.

## Quick Setup

### For Hybrid Mode (Default)

1. **Already configured!** The app is now set to hybrid mode with these defaults:
   ```env
   STORAGE_MODE=hybrid
   LOCAL_STORAGE_PATH=/home/ubuntu/ai_docusign_clone/nextjs_space/uploads
   ENABLE_S3_BACKUP=true
   ```

2. **S3 Configuration** (Optional but recommended):
   - If you want to use your own S3 bucket for backup, add these to `.env`:
   ```env
   AWS_ACCESS_KEY_ID=your_access_key_id
   AWS_SECRET_ACCESS_KEY=your_secret_access_key
   AWS_REGION=us-east-1
   AWS_BUCKET_NAME=your-bucket-name
   AWS_FOLDER_PREFIX=synergysign/
   ```

3. **Disable S3 Backup** (if you want local-only):
   ```env
   ENABLE_S3_BACKUP=false
   ```

### For Local-Only Mode

```env
STORAGE_MODE=local
LOCAL_STORAGE_PATH=/home/ubuntu/ai_docusign_clone/nextjs_space/uploads
```

No AWS credentials needed!

### For S3-Only Mode

```env
STORAGE_MODE=s3
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_REGION=us-east-1
AWS_BUCKET_NAME=your-bucket-name
AWS_FOLDER_PREFIX=synergysign/
```

## File Structure

### Local Storage
```
/home/ubuntu/ai_docusign_clone/nextjs_space/uploads/
├── documents/
│   ├── 1697648400000-contract.pdf
│   ├── 1697648500000-agreement.docx
│   └── ...
└── templates/
    ├── 1697648600000-template.pdf
    └── ...
```

### S3 Storage (if enabled)
```
your-bucket/
└── synergysign/
    ├── documents/
    │   ├── 1697648400000-contract.pdf
    │   └── ...
    └── templates/
        └── ...
```

## API Endpoints

### Upload File
```
POST /api/documents/upload
```
- Saves to local storage immediately
- Backs up to S3 in background (if enabled)
- Returns success even if S3 backup fails

### Download File
```
GET /api/documents/[id]/download
```
- Returns local file URL (hybrid/local mode)
- Returns S3 signed URL (S3-only mode)
- Falls back to S3 if local file missing (hybrid mode)

### Serve File
```
GET /api/files/documents/[filename]
```
- Directly serves file from local storage
- Auto-downloads from S3 if not found locally

## Storage Management

### Check Storage Status

Create a status endpoint to see your current storage configuration:

```typescript
// app/api/storage/status/route.ts
import { getStorageInfo } from "@/lib/storage";

export async function GET() {
  return Response.json(getStorageInfo());
}
```

### Disk Space Monitoring

Monitor your local storage usage:

```bash
# Check uploads folder size
du -sh /home/ubuntu/ai_docusign_clone/nextjs_space/uploads

# Check available disk space
df -h /home/ubuntu/ai_docusign_clone
```

### Backup Verification

Verify files are being backed up to S3:

```bash
# List files in S3 bucket
aws s3 ls s3://your-bucket-name/synergysign/documents/

# Check sync status
aws s3 ls s3://your-bucket-name/synergysign/documents/ --recursive | wc -l
```

## Migration Guide

### Migrate from S3-Only to Hybrid

1. Update `.env`:
   ```env
   STORAGE_MODE=hybrid
   LOCAL_STORAGE_PATH=/home/ubuntu/ai_docusign_clone/nextjs_space/uploads
   ENABLE_S3_BACKUP=true
   ```

2. Restart the app

3. New uploads will be hybrid

4. Old files will be served from S3 until re-uploaded

### Migrate from Local-Only to Hybrid

1. Set up S3 credentials in `.env`

2. Update mode:
   ```env
   STORAGE_MODE=hybrid
   ENABLE_S3_BACKUP=true
   ```

3. Restart the app

4. Existing local files will be served normally

5. Optional: Sync existing files to S3:
   ```bash
   aws s3 sync /home/ubuntu/ai_docusign_clone/nextjs_space/uploads/ s3://your-bucket-name/synergysign/
   ```

## Performance Optimization

### Local Storage
- **Fast**: Direct filesystem access
- **No latency**: Files served immediately
- **No bandwidth costs**: Files served from your server

### S3 Backup
- **Async**: Doesn't slow down uploads
- **Redundant**: Files backed up automatically
- **Scalable**: S3 handles storage limits

### Caching
Files served through `/api/files/*` include cache headers:
```
Cache-Control: private, max-age=3600
```

## Security Considerations

### Local Storage
- Files stored in `/uploads` directory
- Not directly accessible via web (served through API)
- Requires authentication to access

### S3 Storage
- Files not publicly accessible
- Signed URLs expire after 1 hour
- IAM permissions control access

### File Access Control
Both storage modes respect document permissions:
- Only document sender can access
- Only assigned signers can access
- Admin users have full access

## Troubleshooting

### Files Not Uploading
1. Check directory permissions:
   ```bash
   ls -la /home/ubuntu/ai_docusign_clone/nextjs_space/uploads
   chmod 755 /home/ubuntu/ai_docusign_clone/nextjs_space/uploads
   ```

2. Check disk space:
   ```bash
   df -h
   ```

3. Check logs for errors:
   ```bash
   # Server logs will show S3 backup failures (non-fatal)
   ```

### Files Not Found
1. Check if file exists locally:
   ```bash
   ls /home/ubuntu/ai_docusign_clone/nextjs_space/uploads/documents/
   ```

2. Check database for correct path:
   ```sql
   SELECT id, title, cloudStoragePath FROM "documents" LIMIT 10;
   ```

3. In hybrid mode, file will auto-download from S3 if missing locally

### S3 Backup Failing
1. Verify AWS credentials:
   ```bash
   aws s3 ls s3://your-bucket-name
   ```

2. Check S3 permissions (need PutObject, GetObject, DeleteObject)

3. S3 backup failures don't stop uploads - files still saved locally

## Cost Considerations

### Local Storage
- **Server disk space**: Depends on your server plan
- **Bandwidth**: Uses your server bandwidth for downloads
- **No additional costs**: Just your server hosting

### S3 Storage (if enabled)
- **Storage**: ~$0.023/GB/month (S3 Standard)
- **Requests**: $0.005 per 1,000 uploads
- **Bandwidth**: $0.09/GB for downloads (first 1GB free)

### Typical Usage
For 1000 documents (avg 1MB each):
- **Local**: 1GB disk space on your server
- **S3 backup**: ~$0.023/month storage + $0.005 for uploads = **~$0.03/month**

## Best Practices

1. **Use hybrid mode** for best reliability
2. **Monitor disk space** on your server
3. **Enable S3 backup** for disaster recovery
4. **Set up automated backups** of your local storage
5. **Configure S3 lifecycle policies** to archive old documents
6. **Monitor S3 costs** if storing large files
7. **Use environment-specific configurations** (dev vs production)

## Support

For issues or questions:
- Check application logs
- Verify environment variables
- Test with a small file first
- Check AWS console for S3 issues
