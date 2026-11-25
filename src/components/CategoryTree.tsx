import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, Plus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { Category, RouteTarget } from '../types';

interface CategoryTreeProps {
  onNavigate: (target: RouteTarget) => void;
  onCreateSubcategory: (parent: Category) => void;
  refreshKey: number;
}

interface TreeNode extends Category {
  children: TreeNode[];
}

function buildTree(items: Category[]): TreeNode[] {
  const map = new Map<number, TreeNode>();
  for (const item of items) {
    map.set(item.id, { ...item, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    if (node.parent && map.has(node.parent)) {
      map.get(node.parent)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function TreeBranch({
  node,
  depth,
  onNavigate,
  onCreateSubcategory,
}: {
  node: TreeNode;
  depth: number;
  onNavigate: (target: RouteTarget) => void;
  onCreateSubcategory: (parent: Category) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className="flex items-center justify-between py-2 px-3 hover:bg-slate-50 dark:hover:bg-slate-900/70 border-b border-slate-100 dark:border-slate-800/70 transition-colors"
        style={{ paddingLeft: `${depth * 22 + 12}px` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          {expanded && hasChildren ? (
            <FolderOpen className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-slate-400 shrink-0" />
          )}
          <button
            type="button"
            onClick={() => onNavigate({ entity: 'categories', id: node.id })}
            className="text-sm font-medium text-slate-900 dark:text-slate-100 hover:text-teal-600 dark:hover:text-teal-400 hover:underline truncate"
          >
            {node.name}
          </button>
          {node.description && (
            <span className="text-xs text-slate-500 dark:text-slate-400 truncate hidden sm:inline">
              · {node.description}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onCreateSubcategory(node)}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Child</span>
        </button>
      </div>
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <TreeBranch
            key={child.id}
            node={child}
            depth={depth + 1}
            onNavigate={onNavigate}
            onCreateSubcategory={onCreateSubcategory}
          />
        ))}
    </div>
  );
}

export function CategoryTree({
  onNavigate,
  onCreateSubcategory,
  refreshKey,
}: CategoryTreeProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch<{ items: Category[] }>('/api/categories/tree')
      .then((res) => {
        if (active) setTree(buildTree(res.items || []));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
        Loading category hierarchy...
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
        No categories found.
      </div>
    );
  }

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
      {tree.map((root) => (
        <TreeBranch
          key={root.id}
          node={root}
          depth={0}
          onNavigate={onNavigate}
          onCreateSubcategory={onCreateSubcategory}
        />
      ))}
    </div>
  );
}
