import { useEffect, useRef } from 'react';

/**
 * Calls `onOutside` when a pointer/keydown happens outside the returned ref element.
 * Used to dismiss dropdown menus (quick-create, settings, notifications) — the
 * QuickBooks pattern where clicking anywhere else closes the open panel.
 */
export function useClickOutside<T extends HTMLElement = HTMLDivElement>(
  onOutside: () => void,
): React.RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const handle = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOutside();
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onOutside]);

  return ref;
}
