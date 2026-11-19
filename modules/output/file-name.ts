import type { CaptureMetadata } from '@/types/capture';

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

function sanitize(value: string | undefined, maxLength: number): string {
  if (!value) return '';
  const cleaned = value
    .normalize('NFKC')
    .replace(INVALID_FILENAME_CHARS, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, maxLength);
  return cleaned;
}

export function buildTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function buildFileName(metadata: CaptureMetadata): string {
  const capturedAt = new Date(metadata.capturedAt || Date.now());
  const timestamp = buildTimestamp(capturedAt);
  const author = sanitize(metadata.author ?? metadata.authorName, 40);
  const postId = sanitize(metadata.tweetId, 30);
  if (!author && !postId) {
    return `x-post-${timestamp}.png`;
  }
  const parts = ['x-post'];
  if (author) parts.push(author);
  if (postId) parts.push(postId);
  parts.push(timestamp);
  return `${parts.join('-')}.png`;
}