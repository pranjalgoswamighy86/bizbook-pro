'use client';

/**
 * Workspace Selection Modal — Rule 2.2 UI
 * ---------------------------------------
 * When user has 2+ active workspaces, this modal interrupts the routing
 * flow after credential validation.
 *
 * User must choose:
 *   [ Button ] Log in as Main Admin (Your Independent Company Account)
 *   [ Button ] Log in as Connected Staff (Company: ABC Industrial Solutions)
 *   [ Button ] Log in as Connected Staff (Company: Global Retail Enterprise)
 *
 * PLACE AT: components/auth/workspace-selection-modal.tsx
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// ---------- Types ----------
export interface WorkspaceOption {
  tenantId: string;
  tenantName: string;
  role: 'MAIN_ADMIN' | 'JUNIOR_ADMIN' | 'DATA_ENTRY' | 'VIEW_ONLY';
  isOwner: boolean;
  isOwnTenant: boolean;
}

interface Props {
  open: boolean;
  user: { id: string; email: string; name: string } | null;
  workspaces: WorkspaceOption[];
  onSelect: (workspace: WorkspaceOption) => Promise<void>;
  onCancel: () => void;
}

// ---------- Icons ----------
function CrownIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-amber-500">
      <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm0 2h14v2H5v-2z"/>
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-indigo-500">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-emerald-500">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
    </svg>
  );
}

// ---------- Component ----------
export function WorkspaceSelectionModal({
  open,
  user,
  workspaces,
  onSelect,
  onCancel,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open || !user) return null;

  const ownTenant = workspaces.find(w => w.isOwnTenant);
  const connectedStaff = workspaces.filter(w => !w.isOwnTenant);

  const handleSelect = async (workspace: WorkspaceOption) => {
    setLoading(workspace.tenantId);
    setError(null);
    try {
      await onSelect(workspace);
      // On success, parent will redirect
    } catch (err: any) {
      setError(err?.message || 'Failed to log in to selected workspace');
      setLoading(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="p-6 bg-gradient-to-br from-indigo-50 to-blue-50 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center">
              <UsersIcon />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Choose Your Workspace Profile</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Hi {user.name || user.email}, please select the operational category
                you wish to access for this session.
              </p>
            </div>
          </div>
        </div>

        {/* Body — workspace options */}
        <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
          {error && (
            <div className="p-3 mb-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs">
              {error}
            </div>
          )}

          {/* Option 1: Log in as Main Admin (own tenant) */}
          {ownTenant && (
            <button
              onClick={() => handleSelect(ownTenant)}
              disabled={loading !== null}
              className="w-full text-left p-4 rounded-xl border-2 border-amber-200 bg-amber-50/50 hover:bg-amber-50 hover:border-amber-300 transition-all disabled:opacity-50 group"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <CrownIcon />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-slate-900">
                    Log in as Main Admin
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Your independent company account — full control
                  </div>
                  <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 rounded text-[10px] font-bold text-amber-800 uppercase">
                    {ownTenant.tenantName}
                  </div>
                </div>
                {loading === ownTenant.tenantId && (
                  <div className="animate-spin h-4 w-4 border-2 border-amber-500 border-t-transparent rounded-full" />
                )}
              </div>
            </button>
          )}

          {/* Options 2+: Log in as Connected Staff */}
          {connectedStaff.map((workspace) => (
            <button
              key={workspace.tenantId}
              onClick={() => handleSelect(workspace)}
              disabled={loading !== null}
              className="w-full text-left p-4 rounded-xl border-2 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all disabled:opacity-50 group"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <ShieldIcon />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-slate-900">
                    Log in as Connected Staff
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Company: <span className="font-semibold text-slate-700">{workspace.tenantName}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-100 rounded text-[10px] font-bold text-indigo-800 uppercase">
                      {workspace.role.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                {loading === workspace.tenantId && (
                  <div className="animate-spin h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full" />
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button
            onClick={onCancel}
            disabled={loading !== null}
            className="text-xs text-slate-500 hover:text-slate-700 font-medium"
          >
            Cancel
          </button>
          <span className="text-[10px] text-slate-400">
            {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''} available
          </span>
        </div>
      </div>
    </div>
  );
}

/*
 * ============================================================================
 * INTEGRATION EXAMPLE (in your login page component)
 * ============================================================================
 *
 * 'use client';
 * import { useState } from 'react';
 * import { WorkspaceSelectionModal, WorkspaceOption } from '@/components/auth/workspace-selection-modal';
 *
 * export function LoginForm() {
 *   const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
 *   const [resolvedWorkspaces, setResolvedWorkspaces] = useState<WorkspaceOption[]>([]);
 *   const [pendingUser, setPendingUser] = useState(null);
 *
 *   const handleLogin = async (email, password) => {
 *     const res = await fetch('/api/auth', {
 *       method: 'POST',
 *       body: JSON.stringify({ action: 'login', email, password }),
 *     });
 *     const data = await res.json();
 *
 *     if (data.status === 'WORKSPACE_SELECTION_REQUIRED') {
 *       // Rule 2.2: Show modal
 *       setPendingUser(data.user);
 *       setResolvedWorkspaces(data.workspaces);
 *       setShowWorkspaceModal(true);
 *     } else if (data.status === 'LOGGED_IN') {
 *       // Single workspace — already logged in
 *       window.location.href = '/dashboard';
 *     }
 *   };
 *
 *   const handleWorkspaceSelect = async (workspace) => {
 *     const res = await fetch('/api/auth/select-workspace', {
 *       method: 'POST',
 *       body: JSON.stringify({ userId: pendingUser.id, tenantId: workspace.tenantId }),
 *     });
 *     const data = await res.json();
 *     if (data.token) {
 *       document.cookie = `session=${data.token}; path=/; secure; samesite=strict`;
 *       window.location.href = '/dashboard';
 *     }
 *   };
 *
 *   return (
 *     <>
 *       <form onSubmit={...}>...</form>
 *       <WorkspaceSelectionModal
 *         open={showWorkspaceModal}
 *         user={pendingUser}
 *         workspaces={resolvedWorkspaces}
 *         onSelect={handleWorkspaceSelect}
 *         onCancel={() => setShowWorkspaceModal(false)}
 *       />
 *     </>
 *   );
 * }
 * ============================================================================
 */
