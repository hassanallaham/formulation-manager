import type { UploadRecord } from '../types';

let inMemoryAuthToken: string | null = null;

export function setAuthToken(token: string | null): void {
  inMemoryAuthToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryAuthToken;
}

export class ApiError extends Error {
  status: number;
  duplicate?: boolean;
  existingUpload?: UploadRecord;

  constructor(
    message: string,
    status: number,
    extra?: { duplicate?: boolean; existingUpload?: UploadRecord }
  ) {
    super(message);
    this.status = status;
    this.duplicate = extra?.duplicate;
    this.existingUpload = extra?.existingUpload;
  }
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'FormuLab');

  if (inMemoryAuthToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${inMemoryAuthToken}`);
  }

  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let payload: Record<string, unknown> = {};
    try {
      payload = await res.json();
    } catch {
      payload = { error: res.statusText || 'Request failed' };
    }
    throw new ApiError(
      String(payload.error || 'Request failed'),
      res.status,
      {
        duplicate: Boolean(payload.duplicate),
        existingUpload: payload.existingUpload as UploadRecord | undefined,
      }
    );
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return undefined as T;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatMoney(val: number | string | null | undefined, decimals = 4): string {
  const num = Number(val ?? 0);
  if (Number.isNaN(num)) return '0.0000';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: Math.min(2, decimals),
    maximumFractionDigits: decimals,
  });
}
