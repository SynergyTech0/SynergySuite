# Connect Your Own S3 Bucket to SynergySign

## Prerequisites
1. An AWS Account
2. An S3 bucket created in your desired region
3. AWS credentials (Access Key ID and Secret Access Key)

## Setup Steps

### 1. Create an S3 Bucket
- Go to AWS S3 Console: https://console.aws.amazon.com/s3/
- Click "Create bucket"
- Choose a unique bucket name (e.g., `synergysign-documents`)
- Select your preferred region
- Keep default settings or adjust based on your needs
- Click "Create bucket"

### 2. Create IAM User with S3 Access
- Go to IAM Console: https://console.aws.amazon.com/iam/
- Click "Users" → "Add users"
- Create a user (e.g., `synergysign-s3-user`)
- Attach the following policy (or create a custom one):
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ],
        "Resource": [
          "arn:aws:s3:::YOUR-BUCKET-NAME/*",
          "arn:aws:s3:::YOUR-BUCKET-NAME"
        ]
      }
    ]
  }
  ```
- Download the Access Key ID and Secret Access Key

### 3. Configure AWS Credentials

You have two options:

#### Option A: Using Environment Variables (Recommended for Production)
Update your `.env` file with:
```env
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_REGION=us-east-1  # or your bucket's region
AWS_BUCKET_NAME=your-bucket-name
AWS_FOLDER_PREFIX=documents/  # optional: organize files in a folder
```

#### Option B: Using AWS Credentials File (For Development)
Create `~/.aws/credentials`:
```ini
[default]
aws_access_key_id = your_access_key_id
aws_secret_access_key = your_secret_access_key
```

Create `~/.aws/config`:
```ini
[default]
region = us-east-1
```

Then update `.env`:
```env
AWS_REGION=us-east-1
AWS_BUCKET_NAME=your-bucket-name
AWS_FOLDER_PREFIX=documents/
```

### 4. Test the Configuration

After updating the environment variables, restart your application:
```bash
cd /home/ubuntu/ai_docusign_clone/nextjs_space
yarn dev
```

Upload a test document through the SynergySign interface to verify it's working.

### 5. Verify Files in S3
- Go to your S3 bucket in the AWS Console
- You should see uploaded documents in the `documents/` folder (or your specified prefix)

## Security Best Practices

1. **Enable Bucket Versioning**: Protects against accidental deletions
2. **Enable Server-Side Encryption**: Encrypt documents at rest
3. **Set Lifecycle Policies**: Automatically manage old documents
4. **Configure CORS** (if accessing from browser):
   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
       "AllowedOrigins": ["https://yourdomain.com"],
       "ExposeHeaders": []
     }
   ]
   ```
5. **Block Public Access**: Ensure your bucket is not publicly accessible
6. **Use IAM Roles**: For production, use IAM roles instead of access keys

## Cost Considerations

S3 pricing includes:
- **Storage**: $0.023 per GB/month (Standard)
- **Requests**: $0.005 per 1,000 PUT requests
- **Data Transfer**: First 1 GB free, then $0.09 per GB

For a typical e-signature platform:
- 100 documents/month × 1MB each = ~$0.002/month storage
- 100 uploads = $0.0005/month
- Estimated: **< $1/month** for small usage

## Troubleshooting

### "Access Denied" Error
- Verify IAM user has correct permissions
- Check bucket name is correct
- Ensure AWS credentials are properly set

### "Bucket Not Found" Error
- Verify bucket name matches exactly
- Check if bucket is in the correct region
- Ensure region is set correctly in environment variables

### Files Not Uploading
- Check AWS credentials are valid
- Verify bucket policy allows your IAM user
- Review application logs for detailed error messages

## Current Implementation Details

Your SynergySign app uses:
- **AWS SDK v3** (modern, tree-shakeable)
- **Signed URLs** for secure downloads (expires in 1 hour)
- **Direct S3 uploads** (no local storage)
- **Database storage** of S3 keys only

### File Structure in S3:
```
your-bucket/
└── documents/
    ├── 1697648400000-contract.pdf
    ├── 1697648500000-agreement.docx
    └── ...
```

### Database Schema:
```
Document {
  cloudStoragePath: "documents/1697648400000-contract.pdf"  // S3 key
  originalFileName: "contract.pdf"
  fileSize: 245760
  fileType: "application/pdf"
  ...
}
```

## Support

For AWS-specific issues:
- AWS Documentation: https://docs.aws.amazon.com/s3/
- AWS Support: https://console.aws.amazon.com/support/

For SynergySign integration issues:
- Check application logs
- Verify environment variables are set correctly
- Ensure S3 bucket is in the same region as specified
