
interface IconProps {
  size?: number;
  stroke?: string;
  fill?: string;
}

export function SidebarHomeIcon({ size = 26, stroke = 'currentColor', fill = 'none' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10L12 3l9 7" />
      <path d="M9 21V12h6v9" />
      <path d="M21 10v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10" />
    </svg>
  );
}

export function SidebarPostIcon({ size = 26, stroke = 'currentColor', fill = 'none' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

export function SidebarProfileIcon({ size = 26, stroke = 'currentColor', fill = 'none' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    </svg>
  );
}
