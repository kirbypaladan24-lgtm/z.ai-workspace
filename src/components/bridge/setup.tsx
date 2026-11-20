'use client';

/* ------------------------------------------------------------------ */
/* Setup — pairing, the reconnect kit for new machines, and the        */
/* plain-english guide to how the bridge works.                        */
/* ------------------------------------------------------------------ */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  KeyRound, Download, User, ClipboardPaste, ArrowRight, Gamepad2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SvcStatus } from './types';
import { CopyField, Dot, Panel, ViewHeader } from './bits';

/* PairCard — the one pairing entry point, reused on Overview + Setup. */
export function PairCard({ pairInput, onPairInputChange, onPair, onPasteAndPair, pairingNote, onGoToGuide }: {
  pairInput: string;
  onPairInputChange: (v: string) => void;
  onPair: (code: string) => void;
  onPasteAndPair: () => void;
  pairingNote: string | null;
  onGoToGuide?: () => void;
}) {
  return (
    <Panel className="border-vs-blue/25 shadow-[0_0_40px_-16px_rgba(16,185,129,0.28)]">
      <div className="p-6 sm:p-8 max-w-2xl mx-auto text-center">
        <div className="mx-auto mb-4 size-12 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 ring-1 ring-emerald-300/30 shadow-[0_0_22px_-6px_rgba(16,185,129,0.6)] grid place-items-center">
          <KeyRound className="size-5 text-[#03231a]" strokeWidth={2.25} />
        </div>
        <h2 className="text-sm font-semibold text-vs-bright">Pair this browser with your workspace</h2>
        <p className="text-xs text-vs-dim mt-2 leading-relaxed max-w-md mx-auto">
          In VS Code, open the <span className="text-vs-text">AI Code Agent</span> panel (the zap icon) — the connector
          shows a 6-character pairing code. Enter it once to unlock everything on this dashboard.
        </p>
        <div className="flex items-center justify-center gap-2 mt-5 flex-wrap">
          <Input
            value={pairInput}
            onChange={(e) => onPairInputChange(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && onPair(pairInput)}
            placeholder="6-char code"
            maxLength={12}
            autoFocus
            className="font-mono tracking-[0.2em] w-44 h-10 text-center"
            aria-label="Pairing code"
          />
          <Button onClick={() => onPair(pairInput)} className="h-10 font-semibold">Pair</Button>
          <Button onClick={onPasteAndPair} variant="outline" className="h-10 border-vs-border-2" title="Paste code from clipboard">
            <ClipboardPaste className="size-4" />
          </Button>
        </div>
        {pairingNote && <p className="text-xs text-vs-yellow mt-3">{pairingNote}</p>}
        {onGoToGuide && (
          <button suppressHydrationWarning className="text-[11px] text-vs-blue-bright hover:underline mt-4 inline-flex items-center gap-1" onClick={onGoToGuide}>
            full setup guide <ArrowRight className="size-3" />
          </button>
        )}
      </div>
    </Panel>
  );
}

/* The full Setup view. */
export function SetupView({
  paired, svcUp, wsOnline, status, pageUrl,
  pairInput, onPairInputChange, onPair, onPasteAndPair, pairingNote,
}: {
  paired: boolean;
  svcUp: boolean;
  wsOnline: boolean;
  status: SvcStatus;
  pageUrl: string;
  pairInput: string;
  onPairInputChange: (v: string) => void;
  onPair: (code: string) => void;
  onPasteAndPair: () => void;
  pairingNote: string | null;
}) {
  return (
    <div className="space-y-4 max-w-3xl">
      <ViewHeader
        title="Setup"
        sub="Connect VS Code to this dashboard — all copy-paste, no URL editing."
      />

      {/* current status */}
      <Panel>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <Dot tone={svcUp ? 'green' : 'red'} />
            <div className="min-w-0">
              <div className="text-xs text-vs-bright truncate">bridge service</div>
              <div className="text-[11px] text-vs-dim">{svcUp ? 'online' : 'offline — auto-reviving…'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 min-w-0">
            <Dot tone={wsOnline ? 'green' : 'yellow'} />
            <div className="min-w-0">
              <div className="text-xs text-vs-bright truncate">workspace</div>
              <div className="text-[11px] text-vs-dim truncate">{wsOnline ? status.workspaceName ?? 'online' : 'offline — open VS Code'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 min-w-0">
            <Dot tone={paired ? 'green' : 'dim'} />
            <div className="min-w-0">
              <div className="text-xs text-vs-bright truncate">this browser</div>
              <div className="text-[11px] text-vs-dim">{paired ? 'paired' : 'not paired yet'}</div>
            </div>
          </div>
        </div>
      </Panel>

      {/* pairing */}
      {!paired && (
        <PairCard
          pairInput={pairInput}
          onPairInputChange={onPairInputChange}
          onPair={onPair}
          onPasteAndPair={onPasteAndPair}
          pairingNote={pairingNote}
        />
      )}

      {/* reconnect kit — new machine setup, visible while the workspace is offline */}
      {!wsOnline && (
        <Panel>
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-2.5 flex-wrap">
              <Download className="size-4 text-vs-green" />
              <h2 className="text-[13px] font-medium text-vs-bright">Reconnect kit — new machine setup</h2>
              <span className="text-[10px] uppercase tracking-wide text-vs-yellow border border-vs-yellow/40 rounded px-1.5 py-0.5">workspace offline</span>
            </div>
            <p className="text-xs text-vs-dim leading-relaxed">
              All copy-paste, no URL editing. This card disappears the moment your VS Code connects.
            </p>
            <div className="space-y-3.5">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <div className="text-[10px] uppercase tracking-wide text-vs-faint lg:w-48 flex-none">1 · download extension</div>
                <div className="flex items-center gap-3 flex-wrap min-w-0">
                  <a
                    href="/ai-code-agent-0.5.0.vsix"
                    download="ai-code-agent-0.5.0.vsix"
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-2 rounded-lg border border-vs-green/40 text-vs-green px-3 py-1.5 text-[11px] font-mono hover:bg-vs-green/10 transition-colors flex-none"
                    title="Download the VSIX (58 KB)"
                  >
                    <Download className="size-3.5" /> ai-code-agent-0.5.0.vsix · 58 KB
                  </a>
                  <span className="text-[10.5px] text-vs-faint">if the preview swallows the click — open this page in a new tab first, then click</span>
                </div>
              </div>
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <div className="text-[10px] uppercase tracking-wide text-vs-faint lg:w-48 flex-none">2 · install (terminal)</div>
                <div className="flex-1 min-w-0">
                  <CopyField value="cd ~/Downloads && code --install-extension ai-code-agent-0.5.0.vsix" />
                </div>
              </div>
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <div className="text-[10px] uppercase tracking-wide text-vs-faint lg:w-48 flex-none">3 · server url → settings</div>
                <div className="flex-1 min-w-0">
                  <CopyField value={pageUrl || '…'} />
                </div>
              </div>
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
                <div className="text-[10px] uppercase tracking-wide text-vs-faint lg:w-48 flex-none">4 · identity (optional)</div>
                <div className="text-[11px] text-vs-dim leading-relaxed flex-1 min-w-0">
                  Only when migrating from a previous bridge install: copy the workspace id + secret from the old setup into{' '}
                  <span className="font-mono text-vs-text">AI Code Agent: Set Workspace Identity…</span>. Skipping this pairs fresh —
                  the dashboard journal starts empty, which is the clean default.
                </div>
              </div>
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
                <div className="text-[10px] uppercase tracking-wide text-vs-faint lg:w-48 flex-none">5 · connect + pair</div>
                <div className="text-[11px] text-vs-dim leading-relaxed flex-1 min-w-0">
                  Command palette → <span className="font-mono text-vs-text">AI Code Agent: Set Workspace Identity…</span> with the two
                  values from step 4, then <span className="font-mono text-vs-text">AI Code Agent: Connect</span>. Its panel shows a
                  6-char pairing code — type it into the pair box above and the dashboard unlocks.
                </div>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {/* roblox studio bridge — the same operation for game development */}
      <Panel>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <Gamepad2 className="size-4 text-vs-teal" />
            <h2 className="text-[13px] font-medium text-vs-bright">Roblox Studio bridge — game development</h2>
          </div>
          <p className="text-xs text-vs-dim leading-relaxed">
            The same bridge, as a Roblox Studio plugin (.rbxm). It pairs like the VS Code extension, streams your
            game&apos;s full hierarchy (services, instances, scripts) into the Workspace view, lets GLM read and edit
            script sources directly in Studio, and mirrors every change into the Activity feed.
          </p>
          <div className="space-y-3.5">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <div className="text-[10px] uppercase tracking-wide text-vs-faint lg:w-48 flex-none">1 · download the plugin</div>
              <div className="flex items-center gap-3 flex-wrap min-w-0">
                <a
                  href="/zai-bridge-roblox.rbxm"
                  download="ZAIWorkspaceBridge.rbxm"
                  className="inline-flex items-center gap-2 rounded-lg border border-vs-teal/40 text-vs-teal px-3 py-1.5 text-[11px] font-mono hover:bg-vs-teal/10 transition-colors flex-none"
                  title="Binary Roblox model — recommended"
                >
                  <Download className="size-3.5" /> ZAIWorkspaceBridge.rbxm
                </a>
                <a
                  href="/zai-bridge-roblox.rbxmx"
                  download="ZAIWorkspaceBridge.rbxmx"
                  className="inline-flex items-center gap-2 rounded-lg border border-vs-border-2 text-vs-dim px-3 py-1.5 text-[11px] font-mono hover:bg-vs-hover hover:text-vs-text transition-colors flex-none"
                  title="XML model — identical, loads the same way"
                >
                  <Download className="size-3.5" /> .rbxmx (XML variant)
                </a>
              </div>
            </div>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
              <div className="text-[10px] uppercase tracking-wide text-vs-faint lg:w-48 flex-none">2 · install it</div>
              <div className="text-[11px] text-vs-dim leading-relaxed flex-1 min-w-0">
                Drop the file into the Studio <span className="font-mono text-vs-text">Plugins</span> folder —
                Windows: <span className="font-mono text-vs-text">%LOCALAPPDATA%\Roblox\Plugins</span> · macOS:
                <span className="font-mono text-vs-text"> ~/Documents/Roblox/Plugins</span> (or Plugins tab → Plugins
                Folder). Restart Studio, then open the <span className="text-vs-text">Z.ai Bridge</span> toolbar button.
              </div>
            </div>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
              <div className="text-[10px] uppercase tracking-wide text-vs-faint lg:w-48 flex-none">3 · allow http requests</div>
              <div className="text-[11px] text-vs-dim leading-relaxed flex-1 min-w-0">
                In Studio: <span className="font-mono text-vs-text">File → Game Settings → Security → Allow HTTP Requests</span> → on.
                The plugin talks to this bridge over HTTP — no WebSockets exist in Studio plugins.
              </div>
            </div>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <div className="text-[10px] uppercase tracking-wide text-vs-faint lg:w-48 flex-none">4 · connect + pair</div>
              <div className="flex-1 min-w-0 space-y-2">
                <CopyField label="this dashboard's url (paste into the plugin)" value={pageUrl || '…'} />
                <div className="text-[11px] text-vs-dim leading-relaxed">
                  Press <span className="text-vs-text">Connect</span> in the plugin — it shows a 6-character code. Type that code
                  into the pair box above and the game becomes this dashboard&apos;s workspace.
                </div>
              </div>
            </div>
          </div>
          <p className="text-[10.5px] text-vs-faint leading-relaxed border-t border-vs-border/70 pt-3">
            One workspace client at a time: connecting the game takes the slot from VS Code (and vice versa) — the same
            first-come/evict rule the extension follows. Shell tools (run_command, get_diagnostics) are not available
            on the Roblox client; scripts, the game tree, search and edits all work identically.
          </p>
        </div>
      </Panel>

      {/* how this works */}
      <Panel>
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-wide text-vs-faint mb-3 flex items-center gap-1.5">
            <User className="size-3.5" /> how this works
          </div>
          <ol className="text-xs text-vs-dim space-y-2.5 leading-relaxed">
            {[
              <>Install the <span className="text-vs-bright">AI Code Agent</span> extension (v0.5.0+) in VS Code — the VSIX lives on this dashboard: <a href="/ai-code-agent-0.5.0.vsix" className="font-mono text-vs-blue-bright underline">/ai-code-agent-0.5.0.vsix</a>.</>,
              <>Settings → <span className="font-mono text-vs-text">aiCodeAgent.serverUrl</span> → paste this page&apos;s URL, then Command palette → <span className="font-mono text-vs-text">AI Code Agent: Connect</span> (migrating machines? <span className="font-mono text-vs-text">AI Code Agent: Set Workspace Identity…</span> first).</>,
              <>Enter the pairing code from the extension panel — once.</>,
              <>Chat with GLM at <span className="text-vs-blue-bright">z.ai</span> and ask it to work on your code.</>,
              <>Every read, write, edit, delete and command appears in the Activity feed, with diffs you can read.</>,
              <>Drop skill documents into a <span className="font-mono text-vs-purple">.skills/</span> folder in your workspace — GLM finds them, reads them and follows them <span className="text-vs-text">before</span> starting a task. Say <span className="font-mono text-vs-text">{'“use the skill <name>”'}</span> in your z.ai chat to apply one.</>,
            ].map((item, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-none size-5 rounded-md bg-vs-panel-2 border border-vs-border grid place-items-center text-[10px] font-mono text-vs-dim mt-0.5">{i + 1}</span>
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      </Panel>
    </div>
  );
}

/* Small status tile reused on Overview. */
export function StatusCard({ label, value, sub, tone, icon, onClick }: {
  label: string; value: string; sub?: string; tone: 'green' | 'red' | 'yellow' | 'dim'; icon: React.ReactNode; onClick?: () => void;
}) {
  return (
    <button
      suppressHydrationWarning
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'rounded-xl border border-vs-border bg-vs-panel px-4 py-3.5 text-left min-w-0 w-full transition-colors',
        onClick && 'hover:bg-vs-hover cursor-pointer'
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="flex-none text-vs-dim">{icon}</span>
        <span className="text-[11px] uppercase tracking-wide text-vs-dim truncate flex-1">{label}</span>
        <Dot tone={tone} />
      </div>
      <div className="mt-2.5 text-sm font-medium text-vs-bright truncate" title={value}>{value}</div>
      {sub ? <div className="text-[11px] text-vs-faint mt-1 truncate">{sub}</div> : null}
    </button>
  );
}
