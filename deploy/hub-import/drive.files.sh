# Run on the old server by run.sh: prints every object in the old SynergyDrive's bucket as
# "<key><TAB><base64>", the key being what file_versions.storage_path holds. It reads through the
# old Drive API container, with the storage address and keys that container already has.
docker exec -i "${HUB_FILES_CONTAINER:-sdrive-api}" python3 - <<'PY'
import base64, os, sys
import boto3

s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["S3_ENDPOINT_URL"],
    aws_access_key_id=os.environ["S3_ACCESS_KEY"],
    aws_secret_access_key=os.environ["S3_SECRET_KEY"],
    region_name=os.environ.get("S3_REGION_NAME") or "us-east-1",
)
bucket = os.environ["S3_BUCKET_NAME"]
for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket):
    for obj in page.get("Contents", []):
        body = s3.get_object(Bucket=bucket, Key=obj["Key"])["Body"].read()
        sys.stdout.write(obj["Key"] + "\t" + base64.b64encode(body).decode() + "\n")
PY
