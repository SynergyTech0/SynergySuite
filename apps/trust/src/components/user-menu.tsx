'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TenantPicker } from './tenant-picker';

type Membership = { tenantId: string; slug: string; name: string; role: string };

/**
 * The organisation and role this browser is acting as. Signing in and out happens in the
 * suite (the app bar above), so there is no sign-out here.
 */
export function UserMenu({
  email,
  name,
  tenantName,
  role,
  readOnly,
  memberships,
  currentTenantId,
}: {
  email: string;
  name: string;
  tenantName: string;
  role: string;
  readOnly: boolean;
  memberships: Membership[];
  currentTenantId: string;
}) {
  const [open, setOpen] = useState(false);
  const canAdminister = role === 'owner' || role === 'admin';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
      >
        <span className="hidden sm:block">
          <span className="block max-w-[14rem] truncate text-xs font-medium text-ink">
            {tenantName}
          </span>
          <span className="block text-[11px] text-ink-3">
            {name || email} · {role}
            {/* Stated in the chrome so a read-only seat is never a surprise discovered at
                the moment someone tries to save something. */}
            {readOnly ? ' · read-only' : ''}
          </span>
        </span>
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[11px] font-semibold text-ink-2"
        >
          {(name || email).slice(0, 2).toUpperCase()}
        </span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-line bg-surface p-2 shadow-lg">
            <div className="px-2 py-1.5">
              <p className="truncate text-xs font-medium text-ink">{name || email}</p>
              <p className="truncate text-[11px] text-ink-3">{email}</p>
            </div>

            {memberships.length > 1 ? (
              <div className="mt-1 border-t border-line pt-2">
                <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  Organisation
                </p>
                <TenantPicker memberships={memberships} current={currentTenantId} compact />
              </div>
            ) : null}

            {canAdminister ? (
              <div className="mt-1 border-t border-line pt-1">
                <Link
                  href="/settings/members"
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-2 py-1.5 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                >
                  Members
                </Link>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
