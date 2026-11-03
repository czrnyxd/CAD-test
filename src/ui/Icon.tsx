/** Icon set of the BusBar CAD design system: 24×24, stroke 2.5, round caps. Always used next to a text label. */
const PATHS = {
  undo: 'M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h3',
  plus: 'M12 4v16M4 12h16',
  folder: 'M3 6h6l2 3h10v11H3z',
  print: 'M7 9V3h10v6M7 17H3V9h18v8h-4M7 14h10v7H7z',
  check: 'M4 13l5 5L20 6',
  stop: 'M8 2.5h8L21.5 8v8L16 21.5H8L2.5 16V8zM12 7v6M12 16.5v.5',
  warn: 'M12 3 22.5 21h-21zM12 10v5M12 18v.5',
  up: 'M12 21V4M5 11l7-7 7 7',
  down: 'M12 3v17M5 13l7 7 7-7',
  rotate: 'M20 12a8 8 0 1 1-2.5-5.8M20 3v5h-5',
  next: 'M9 5l7 7-7 7',
  chevdown: 'M5 9l7 7 7-7',
  back: 'M9 5H21v14H9l-6-7zM12 9l5 6M17 9l-5 6',
  close: 'M5 5l14 14M19 5 5 19',
  trash: 'M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14M10 11v6M14 11v6',
  copy: 'M9 9h12v12H9zM5 15H3V3h12v2',
  search: 'M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15zM16 16l5.5 5.5',
  import: 'M12 3v12M6 10l6 6 6-6M4 21h16',
  export: 'M12 16V4M6 9l6-6 6 6M4 21h16',
  nosave: 'M5 3h12l4 4v14H3V3zM8 3v6h8M7 21v-7h10v7M2 2l20 20',
  more: 'M5 12v.1M12 12v.1M19 12v.1',
  cube: 'M12 2.5 21 7.5v9L12 21.5 3 16.5v-9zM3 7.5l9 5 9-5M12 12.5v9',
  flat: 'M3 8h18v8H3zM9 8v8M15 8v8',
  gear: 'M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  ruler: 'M3 16 16 3l5 5L8 21zM8 11l2 2M11 8l3 3M14 5l2 2',
  dims: 'M3 6v12M21 6v12M3 12h18M7 9l-4 3 4 3M17 9l4 3-4 3',
  hole: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  cloud: 'M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 8.5 4.5 4.5 0 0 1 17.5 18z',
  offline: 'M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 8.5 4.5 4.5 0 0 1 17.5 18zM3 3l18 18',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`bb-ic ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Placeholder brand mark: the profile of a bent bar. */
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg className="bb-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M2 23h10c3 0 5-2 5-5v-5c0-3 2-5 5-5h8"
        fill="none"
        stroke="var(--copper)"
        strokeWidth={6.5}
        strokeLinecap="round"
      />
    </svg>
  );
}
