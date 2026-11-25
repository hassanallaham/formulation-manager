import { useState } from 'react';
import { FileCode2, FileImage, FileText } from 'lucide-react';

interface UploadPreviewProps {
  uploadId: number | null | undefined;
  mimetype?: string | null;
  thumbnailPath?: string | null;
  name?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

export function UploadPreview({
  uploadId,
  mimetype,
  thumbnailPath,
  name,
  size = 'sm',
}: UploadPreviewProps) {
  const [imgError, setImgError] = useState(false);

  const dims =
    size === 'lg'
      ? 'w-24 h-24 rounded-lg'
      : size === 'md'
        ? 'w-12 h-12 rounded-md'
        : 'w-8 h-8 rounded';

  const iconSize = size === 'lg' ? 'w-9 h-9' : size === 'md' ? 'w-5 h-5' : 'w-4 h-4';

  if (uploadId && thumbnailPath && !imgError) {
    return (
      <img
        src={`/api/uploads/${uploadId}/thumbnail`}
        alt={name || 'Uploaded image'}
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
        className={`${dims} object-cover border border-slate-200 dark:border-slate-800 shrink-0 bg-slate-100 dark:bg-slate-900`}
      />
    );
  }

  const mime = (mimetype || '').toLowerCase();
  const ext = (name || '').toLowerCase();

  let Icon = FileText;
  let label = 'FILE';
  let tint = 'text-slate-500 dark:text-slate-400';

  if (mime.includes('pdf') || ext.endsWith('.pdf')) {
    Icon = FileText;
    label = 'PDF';
    tint = 'text-rose-600 dark:text-rose-400';
  } else if (mime.includes('markdown') || ext.endsWith('.md') || ext.endsWith('.markdown')) {
    Icon = FileCode2;
    label = 'MD';
    tint = 'text-sky-600 dark:text-sky-400';
  } else if (mime.startsWith('text/') || ext.endsWith('.txt')) {
    Icon = FileText;
    label = 'TXT';
    tint = 'text-amber-600 dark:text-amber-400';
  } else if (mime.startsWith('image/')) {
    Icon = FileImage;
    label = 'IMG';
    tint = 'text-teal-600 dark:text-teal-400';
  }

  return (
    <div
      className={`${dims} flex flex-col items-center justify-center border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 shrink-0`}
      title={name || label}
    >
      <Icon className={`${iconSize} ${tint}`} />
      {size === 'lg' && (
        <span className="mt-1 text-[10px] font-mono font-semibold text-slate-500 dark:text-slate-400">
          {label}
        </span>
      )}
    </div>
  );
}
