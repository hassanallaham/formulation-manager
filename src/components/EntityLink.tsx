import type { EntityType, RouteTarget } from '../types';
import { UploadPreview } from './UploadPreview';

interface EntityLinkProps {
  entity: EntityType;
  id: number | null | undefined;
  name: string | null | undefined;
  onNavigate: (target: RouteTarget) => void;
  thumbnailPath?: string | null;
  mimetype?: string | null;
  showPreview?: boolean;
  className?: string;
}

export function EntityLink({
  entity,
  id,
  name,
  onNavigate,
  thumbnailPath,
  mimetype,
  showPreview = false,
  className = '',
}: EntityLinkProps) {
  if (!id || !name) {
    return <span className="text-slate-400 dark:text-slate-500">—</span>;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onNavigate({ entity, id });
      }}
      className={`inline-flex items-center gap-2 text-left font-medium text-teal-700 dark:text-teal-400 hover:text-teal-900 dark:hover:text-teal-300 hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded transition-colors ${className}`}
    >
      {showPreview && (
        <UploadPreview
          uploadId={id}
          thumbnailPath={thumbnailPath}
          mimetype={mimetype}
          name={name}
          size="sm"
        />
      )}
      <span className="truncate max-w-[240px]">{name}</span>
    </button>
  );
}
