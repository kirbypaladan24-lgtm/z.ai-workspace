'use client';

/* ------------------------------------------------------------------ */
/* Workspace — the file explorer and the inline file viewer.           */
/* ------------------------------------------------------------------ */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ChevronRight, ChevronDown, Folder, FolderOpen, RefreshCw, Loader2, Search,
  FileCode, Copy, CheckCircle2, X, FolderTree, WifiOff, HardDrive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileViewState, TreeNode, TreePayload } from './types';
import { fmtBytes } from './types';
import { Dot, EmptyState, FileIconFor, LockedPanel, Panel, ViewHeader, CountBadge } from './bits';

/* One row of the tree — a folder (toggle) or a file (open preview). */
export function FileRow({
  node, depth, expanded, onToggle, onOpen, active, highlight,
}: {
  node: TreeNode; depth: number; expanded: boolean; onToggle: () => void; onOpen: () => void; active: boolean; highlight: boolean;
}) {
  const pad = 8 + depth * 14;
  if (node.type === 'dir') {
    return (
      <button
        suppressHydrationWarning
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 py-[3.5px] px-2 rounded-md hover:bg-vs-hover text-left transition-colors"
        style={{ paddingLeft: pad }}
        data-path={node.path}
      >
        {expanded ? <ChevronDown className="size-3.5 text-vs-dim flex-none" /> : <ChevronRight className="size-3.5 text-vs-dim flex-none" />}
        {expanded ? <FolderOpen className="size-4 text-vs-folder flex-none" /> : <Folder className="size-4 text-vs-folder flex-none" />}
        <span className="truncate text-xs text-vs-text">{node.name}</span>
        <span className="text-[10px] text-vs-faint flex-none">{(node.children?.length ?? 0)}</span>
      </button>
    );
  }
  return (
    <button
      suppressHydrationWarning
      onClick={onOpen}
      className={cn(
        'w-full flex items-center gap-1.5 py-[3.5px] px-2 rounded-md text-left group transition-colors',
        active ? 'bg-vs-active' : 'hover:bg-vs-hover'
      )}
      style={{ paddingLeft: pad + 17 }}
      data-path={node.path}
      title={node.path}
    >
      <FileIconFor name={node.name} />
      {highlight ? (
        <span className="truncate text-xs text-vs-text">{node.path}</span>
      ) : (
        <span className="truncate text-xs text-vs-text group-hover:text-vs-bright">{node.name}</span>
      )}
      <span className="flex-1" />
      {node.size !== null && node.size !== undefined && (
        <span className="text-[10px] text-vs-faint flex-none">{fmtBytes(node.size)}</span>
      )}
    </button>
  );
}

/* The file preview card — path header, meta, copy, close. */
export function FileViewer({ view, onClose }: { view: FileViewState; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(view.content ?? '')
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); })
      .catch(() => undefined);
  };
  return (
    <Panel className="flex flex-col min-h-0">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-vs-border/70 min-w-0">
        <FileCode className="size-4 text-vs-dim flex-none" />
        <span className="text-xs font-mono text-vs-bright truncate flex-1 min-w-0" title={view.path}>{view.path}</span>
        {view.meta?.bytes !== undefined && (
          <CountBadge className="flex-none">
            {fmtBytes(view.meta.bytes)}{view.meta?.lines ? ` · ${view.meta.lines} lines` : ''}
          </CountBadge>
        )}
        <Button variant="ghost" size="sm" className="h-7 px-2 text-vs-dim" onClick={copy} title="Copy content">
          {copied ? <CheckCircle2 className="size-3.5 text-vs-green" /> : <Copy className="size-3.5" />}
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-vs-dim" onClick={onClose} title="Close">
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="p-3 min-w-0">
        {view.loading ? (
          <div className="py-12 text-center text-vs-dim text-xs flex flex-col items-center gap-2.5">
            <Loader2 className="size-5 animate-spin" /> reading {view.path}…
          </div>
        ) : view.error ? (
          <div className="py-8 text-center text-vs-red text-xs">{view.error}</div>
        ) : (
          <pre className="text-[11px] font-mono text-vs-text whitespace-pre-wrap break-all bg-vs-bg border border-vs-border rounded-lg p-3.5 max-h-[68vh] overflow-auto" data-testid="file-content">
            {(view.content ?? '').slice(0, 300000) || '(empty file)'}
          </pre>
        )}
      </div>
    </Panel>
  );
}

/* The full Workspace view: explorer on the left, preview on the right. */
export function WorkspaceView({
  paired, wsOnline, tree, treeLoading, filter, onFilterChange, onRefresh, rows,
  expandedPaths, onToggleDir, onOpenFile, fileView, onCloseFile,
  totalFlatHits, showAllFlat, onShowAllFlat, onCollapseAll, workspaceName,
}: {
  paired: boolean;
  wsOnline: boolean;
  tree: TreePayload | null;
  treeLoading: boolean;
  filter: string;
  onFilterChange: (v: string) => void;
  onRefresh: () => void;
  rows: { node: TreeNode; depth: number }[];
  expandedPaths: Set<string>;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  fileView: FileViewState | null;
  onCloseFile: () => void;
  totalFlatHits: number;
  showAllFlat: boolean;
  onShowAllFlat: (v: boolean) => void;
  onCollapseAll: () => void;
  workspaceName: string | null | undefined;
}) {
  return (
    <div className="space-y-4">
      <ViewHeader
        title="Workspace"
        sub={tree?.name ?? workspaceName ? `Every file in ${tree?.name ?? workspaceName} — click one to preview it.` : 'Every file in your VS Code workspace — click one to preview it.'}
      />

      {!paired ? (
        <Panel><LockedPanel text="Pair this browser to explore every file in your VS Code workspace." /></Panel>
      ) : !wsOnline ? (
        <Panel><LockedPanel text="Workspace offline — open VS Code with the AI Code Agent extension connected." icon={<WifiOff className="size-5" />} /></Panel>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          {/* Explorer */}
          <Panel className="flex flex-col min-h-0">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-vs-border/70 flex-wrap">
              <FolderTree className="size-4 text-vs-folder flex-none" />
              <h2 className="text-[13px] font-medium text-vs-bright">Explorer</h2>
              {tree?.name && <CountBadge>{tree.name}</CountBadge>}
              {tree?.stats?.truncated && <CountBadge className="border-vs-yellow/40 text-vs-yellow">truncated</CountBadge>}
              <div className="flex-1" />
              <div className="relative">
                <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-vs-dim" />
                <Input
                  value={filter}
                  onChange={(e) => onFilterChange(e.target.value)}
                  placeholder="filter files…"
                  className="h-8 text-xs pl-8 w-44 sm:w-56"
                />
              </div>
              <Button onClick={onRefresh} disabled={treeLoading} variant="outline" size="sm" className="border-vs-border-2 h-8 w-8 p-0" title="Rescan workspace">
                {treeLoading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              </Button>
            </div>

            <div className="p-2 min-w-0">
              {!tree?.tree ? (
                <div className="text-center py-16 text-vs-dim text-xs">
                  {treeLoading ? <Loader2 className="size-6 animate-spin mx-auto mb-3" /> : <FolderTree className="size-6 mx-auto mb-3" />}
                  <p className="max-w-sm mx-auto leading-relaxed">
                    {treeLoading
                      ? 'Scanning the workspace…'
                      : 'No workspace scan yet. Press the refresh button, or make sure the AI Code Agent extension v0.4.0+ is installed in VS Code.'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="max-h-[68vh] overflow-y-auto text-xs font-mono" data-testid="file-explorer">
                    {rows.length === 0 && (
                      <p className="text-center text-vs-dim py-10">
                        {filter ? `No files match “${filter}”.` : 'Empty workspace.'}
                      </p>
                    )}
                    {rows.map(({ node, depth }) => (
                      <FileRow
                        key={node.path}
                        node={node}
                        depth={depth}
                        expanded={node.type === 'dir' && expandedPaths.has(node.path)}
                        onToggle={() => onToggleDir(node.path)}
                        onOpen={() => onOpenFile(node.path)}
                        active={fileView?.path === node.path}
                        highlight={!!filter.trim()}
                      />
                    ))}
                    {filter && totalFlatHits > 300 && !showAllFlat && (
                      <button suppressHydrationWarning className="w-full text-center py-2.5 text-[11px] text-vs-blue-bright hover:underline" onClick={() => onShowAllFlat(true)}>
                        show {Math.min(totalFlatHits, 1000) - 300} more of {totalFlatHits} matches…
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[10.5px] text-vs-dim flex-wrap px-2 pt-2.5 border-t border-vs-border/60 mt-2">
                    <Dot tone={wsOnline ? 'green' : 'dim'} className="size-1.5" />
                    <span>{tree.stats?.files?.toLocaleString()} files · {tree.stats?.dirs?.toLocaleString()} folders</span>
                    {tree.stats?.totalBytes ? <span>· {fmtBytes(tree.stats.totalBytes)}</span> : null}
                    {tree.stats?.scannedAt ? <span className="hidden md:inline">· scanned {new Date(tree.stats.scannedAt).toLocaleTimeString()}</span> : null}
                    <span className="flex-1" />
                    <button suppressHydrationWarning className="hover:text-vs-text transition-colors" onClick={onCollapseAll}>
                      collapse all
                    </button>
                  </div>
                </>
              )}
            </div>
          </Panel>

          {/* Preview */}
          {fileView ? (
            <div className="xl:sticky xl:top-4">
              <FileViewer view={fileView} onClose={onCloseFile} />
            </div>
          ) : (
            <Panel>
              <EmptyState
                icon={<HardDrive className="size-5" />}
                title="No file selected"
                hint="Click any file in the explorer to preview its contents here — with copy to clipboard."
              />
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
