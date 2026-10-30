// Nightly copy of every Supabase Storage file to the S3 backup bucket (security spec B3).
// Adds files the backup doesn't have yet. Never deletes or overwrites: evidence files are
// immutable, and the bucket's Object Lock refuses deletes for 35 days anyway.
// Each copy carries its SHA-256 so a restore can be checked against the original.
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
};

const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_BACKUP_SECRET_KEY"), {
  auth: { persistSession: false },
});
const s3 = new S3Client({ region: env("AWS_REGION") });
const backupBucket = env("BACKUP_BUCKET");
const PREFIX = "files/";

async function backedUpKeys() {
  const keys = new Set();
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: backupBucket, Prefix: PREFIX, ContinuationToken: token }),
    );
    for (const item of page.Contents ?? []) keys.add(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

// Supabase lists one folder level at a time; entries with no id are folders.
async function listFiles(bucket, folder = "") {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 1000, offset });
    if (error) throw new Error(`List ${bucket}/${folder}: ${error.message}`);
    for (const entry of data) {
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.id === null) files.push(...(await listFiles(bucket, path)));
      else if (entry.name !== ".emptyFolderPlaceholder") files.push(path);
    }
    if (data.length < 1000) return files;
  }
}

async function copyFile(bucket, path, key) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`Download ${bucket}/${path}: ${error.message}`);
  const body = Buffer.from(await data.arrayBuffer());
  const digest = createHash("sha256").update(body).digest();
  await s3.send(
    new PutObjectCommand({
      Bucket: backupBucket,
      Key: key,
      Body: body,
      ContentType: data.type || undefined,
      ChecksumSHA256: digest.toString("base64"),
      Metadata: { sha256: digest.toString("hex") },
    }),
  );
}

const existing = await backedUpKeys();
const { data: buckets, error } = await supabase.storage.listBuckets();
if (error) throw new Error(`List buckets: ${error.message}`);

let copied = 0;
let failed = 0;
for (const { name: bucket } of buckets) {
  const files = await listFiles(bucket);
  for (const path of files) {
    const key = `${PREFIX}${bucket}/${path}`;
    if (existing.has(key)) continue;
    try {
      await copyFile(bucket, path, key);
      copied += 1;
    } catch (err) {
      failed += 1;
      console.error(err.message);
    }
  }
  console.log(`${bucket}: ${files.length} files`);
}

console.log(`Copied ${copied} new files; ${existing.size} already backed up; ${failed} failed.`);
if (failed > 0) process.exit(1);
