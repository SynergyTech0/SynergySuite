import type { ReactNode } from 'react';
import { Search } from 'lucide-react';

/**
 * Filter/search bar that sits at the top of a list card. Pass `onSearch` for the
 * search box; put filter <select>s (or anything) in `children`, right-aligned.
 */
export function Toolbar({
  search,
  onSearch,
  placeholder = 'Search…',
  children,
}: {
  search?: string;
  onSearch?: (value: string) => void;
  placeholder?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-200">
      {onSearch && (
        <div className="relative flex-1 min-w-[12rem] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            value={search ?? ''}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      )}
      {children && <div className="flex items-center gap-2 ml-auto">{children}</div>}
    </div>
  );
}
