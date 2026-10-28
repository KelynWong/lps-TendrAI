// Tender job queue. One message per processing run; EventBridge Pipes starts
// the Step Functions workflow (infra/modules/tendrai/sqs.tf, statemachine/*.asl.json).
// TenderJobMessage is the source of truth for the message contract: the Pipe
// input_template, the state machine and the Lambda docstrings follow it.
// Send only after the job row has committed (lib/jobs.ts dispatchJob).
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { Config } from '../config.js';

export type JobFileType = 'pdf' | 'doc' | 'docx' | 'xls' | 'xlsx' | 'csv';

export interface JobDocument {
  documentId: string;
  key: string;
  fileType: JobFileType;
  /** text already extracted on a previous run; the workflow reuses textPrefix instead of re-extracting */
  textReady: boolean;
  /** extracted/<tenderId>/<documentId>/... from the previous run; null when textReady is false */
  textPrefix: string | null;
}

export interface TenderJobMessage {
  tenderId: string;
  jobId: string;
  mode: 'process' | 'reprocess' | 'retry-document';
  documents: JobDocument[];
  requestedBy: string;
}

export function fileTypeOf(name: string): JobFileType | null {
  const ext = name.toLowerCase().split('.').pop();
  return ext === 'pdf' || ext === 'doc' || ext === 'docx' || ext === 'xls' || ext === 'xlsx' || ext === 'csv' ? ext : null;
}

export function createQueue(cfg: Config) {
  const sqs = new SQSClient({ region: cfg.AWS_REGION });
  return {
    enabled: !!cfg.JOB_QUEUE_URL,
    async sendJob(msg: TenderJobMessage): Promise<string | undefined> {
      if (!cfg.JOB_QUEUE_URL) return undefined;
      const r = await sqs.send(new SendMessageCommand({ QueueUrl: cfg.JOB_QUEUE_URL, MessageBody: JSON.stringify(msg) }));
      return r.MessageId;
    },
  };
}

export type Queue = ReturnType<typeof createQueue>;
