/**
 * Klik's mark as vectors, for paper. `public/klik-mark.png` is 128 pixels,
 * which is soft once a sign is printed; this is the same K, traced from it,
 * that stays sharp at any size.
 */
export function KlikMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 128 128" role="img" aria-label="Klik">
      <rect width="128" height="128" rx="28" fill="#050507" />
      <g fill="none" stroke="#d9e11c" strokeLinecap="round" strokeWidth="28">
        <path d="M30 30 V108" />
        <path d="M30 83 L86.5 34" />
        <path d="M52 63 L104 113" />
      </g>
      <g fill="none" stroke="#ffffff" strokeLinecap="round" strokeWidth="3.2">
        <path d="M98.6 9.2 L96.9 15.8" />
        <path d="M110.4 14.6 L104.6 20.2" />
        <path d="M107 26.9 L115.8 26.5" />
      </g>
    </svg>
  );
}
