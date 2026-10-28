// S3 access: presigned uploads/downloads, object checks, Glacier archive and
// restore, bucket health for the Backup page.
//
// Key layout in the documents bucket (see db/README.md):
//   tenders/<tenderId>/pack/<documentId>/source.<ext>    tender pack uploads (ids only: these keys
//                                                         flow through the processing workflow and its
//                                                         logs; the file name lives in tender_documents)
//   tenders/<tenderId>/business-case/v<n>/<file>          business case workbooks
//   tenders/<tenderId>/mspo/<plan>-v<n>-<ts>.xlsx         generated MSPO templates (optional copy)
//   drafts/<tenderId>/<checklistItemId>/<file>            generated first drafts
//   generated/<tenderId>/<genDocId>/<file>                generated submission documents
//   exports/<tenderId>/<file>                             clause exports
//   library/<itemId>/v<version>/<file>                    templates, boilerplate, certificates, CVs
//   repository/<recordId>/<file>                          historical records
//   extracted/, normalized/, analysis/ are written by the workflow (infra/modules/tendrai/locals.tf).
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetBucketReplicationCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  RestoreObjectCommand,
  S3Client,
  type StorageClass,
} from '@aws-sdk/client-s3';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.js';

export const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200);
const extOf = (name: string) => {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return /^[a-z0-9]{1,5}$/.test(ext) && ext !== name.toLowerCase() ? ext : 'bin';
};

export function keys(tenderId: string) {
  return {
    pack: (docId: string, file: string) => `tenders/${tenderId}/pack/${docId}/source.${extOf(file)}`,
    bc: (v: number, file: string) => `tenders/${tenderId}/business-case/v${v}/${safeName(file)}`,
    mspo: (plan: string, v: number) => `tenders/${tenderId}/mspo/${plan}-v${v}-${Date.now()}.xlsx`,
    draft: (itemId: string, file: string) => `drafts/${tenderId}/${itemId}/${safeName(file)}`,
    generated: (docId: string, file: string) => `generated/${tenderId}/${docId}/${safeName(file)}`,
    export: (file: string) => `exports/${tenderId}/${safeName(file)}`,
  };
}
export const libraryKey = (itemId: string, version: string, file: string) => `library/${itemId}/v${safeName(version)}/${safeName(file)}`;
export const repositoryKey = (recordId: string, file: string) => `repository/${recordId}/${safeName(file)}`;

export interface HeadInfo { size: number; contentType?: string; versionId?: string; storageClass?: string; restore?: string }

export function createStorage(cfg: Config) {
  const s3 = new S3Client({ region: cfg.AWS_REGION });
  const cw = new CloudWatchClient({ region: cfg.AWS_REGION });
  const Bucket = cfg.DOCUMENTS_BUCKET;
  const ttl = cfg.PRESIGN_TTL_SECONDS;

  return {
    bucket: Bucket,

    /** Browser PUTs the file straight to S3 (SSE-KMS applied by bucket default). */
    presignUpload(key: string, contentType?: string) {
      return getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ServerSideEncryption: 'aws:kms' }), { expiresIn: ttl });
    },

    presignDownload(key: string, fileName?: string, versionId?: string) {
      return getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket, Key: key, VersionId: versionId, ResponseContentDisposition: fileName ? `attachment; filename="${safeName(fileName)}"` : undefined }),
        { expiresIn: ttl },
      );
    },

    async head(key: string): Promise<HeadInfo | null> {
      try {
        const h = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: h.ContentLength ?? 0, contentType: h.ContentType, versionId: h.VersionId, storageClass: h.StorageClass, restore: h.Restore };
      } catch (e) {
        if ((e as { name?: string }).name === 'NotFound' || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
        throw e;
      }
    },

    async put(key: string, body: Buffer | string, contentType: string) {
      const r = await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'aws:kms' }));
      return r.VersionId;
    },

    async get(key: string): Promise<Buffer> {
      const r = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    },

    async delete(key: string) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },

    /** Archive: rewrite the object into a Glacier storage class in place. */
    async changeStorageClass(key: string, storageClass: StorageClass) {
      await s3.send(new CopyObjectCommand({
        Bucket, Key: key, CopySource: `/${Bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`,
        StorageClass: storageClass, MetadataDirective: 'COPY', ServerSideEncryption: 'aws:kms',
      }));
    },

    /** Restore an archived object for `days`; completes asynchronously (hours). */
    async requestRestore(key: string, days = 7) {
      try {
        await s3.send(new RestoreObjectCommand({ Bucket, Key: key, RestoreRequest: { Days: days, GlacierJobParameters: { Tier: 'Standard' } } }));
      } catch (e) {
        // RestoreAlreadyInProgress is fine
        if ((e as { name?: string }).name !== 'RestoreAlreadyInProgress') throw e;
      }
    },

    /** true when the archived object is readable now (restore finished or not archived). */
    async isReadable(key: string): Promise<boolean> {
      const h = await this.head(key);
      if (!h) return false;
      const archived = h.storageClass === 'GLACIER' || h.storageClass === 'DEEP_ARCHIVE';
      if (!archived) return true;
      return !!h.restore && /ongoing-request="false"/.test(h.restore);
    },

    /** Backup page: versioning, replication and size/object-count metrics. */
    async bucketHealth(bucket = Bucket) {
      const [ver, rep] = await Promise.all([
        s3.send(new GetBucketVersioningCommand({ Bucket: bucket })).catch(() => null),
        s3.send(new GetBucketReplicationCommand({ Bucket: bucket })).catch(() => null),
      ]);
      const end = new Date();
      const start = new Date(end.getTime() - 3 * 24 * 3600 * 1000);
      const metric = async (name: string, storage: string) => {
        const r = await cw.send(new GetMetricStatisticsCommand({
          Namespace: 'AWS/S3', MetricName: name, Statistics: ['Average'], Period: 86400, StartTime: start, EndTime: end,
          Dimensions: [{ Name: 'BucketName', Value: bucket }, { Name: 'StorageType', Value: storage }],
        })).catch(() => null);
        const points = (r?.Datapoints ?? []).sort((a, b) => (a.Timestamp?.getTime() ?? 0) - (b.Timestamp?.getTime() ?? 0));
        return points.at(-1)?.Average ?? null;
      };
      const [objects, bytes] = await Promise.all([metric('NumberOfObjects', 'AllStorageTypes'), metric('BucketSizeBytes', 'StandardStorage')]);
      return {
        versioning: ver?.Status ?? 'Unknown',
        mfaDelete: ver?.MFADelete ?? 'Disabled',
        replication: rep?.ReplicationConfiguration?.Rules?.map((r) => ({ id: r.ID, status: r.Status, destination: r.Destination?.Bucket })) ?? [],
        objects,
        bytes,
      };
    },
  };
}

export type Storage = ReturnType<typeof createStorage>;
