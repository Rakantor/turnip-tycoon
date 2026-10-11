import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/** Drawn like lucide's icons and filling about as much of the box, to sit beside them on the price board. */
function Icon({ size = 24, children, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

/** A bag of bells, the island currency: tied with a ribbon, a star on the front. */
export function BellBag(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.7 8.26C8.9 6.42 7.98 4.35 6.83 2.28c2.76-.69 5.98-.46 7.93.69 1.49.92 1.26 3.22-.11 5.29" />
      <path d="M8.55 8.26h6.32l2.64 2.07" />
      <path d="M9.12 8.26C5.45 9.64 2.8 12.86 2.8 16.54 2.8 20.22 6.94 22.06 12 22.06s9.2-1.84 9.2-5.52c0-3.68-2.64-6.9-6.32-8.28" />
      <path
        fill="currentColor"
        strokeWidth={1}
        d="M10.85 12.06l1.03 2.42 2.53.23-1.95 1.61.57 2.64-2.18-1.38-2.18 1.38.57-2.64-1.95-1.61 2.53-.23Z"
      />
    </Icon>
  );
}

/** A turnip: the root with its two leaves. */
export function Turnip(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 8C12 4.8 10.3 2.6 7 2c0 3.2 1.7 5.4 5 6ZM12 8c0-3.2 1.7-5.4 5-6 0 3.2-1.7 5.4-5 6Z" />
      <path d="M12 8c-4.5 0-8 2.7-8 6.3 0 3 2.6 5.3 6 6l2 1.9 2-1.9c3.4-.7 6-3 6-6C20 10.7 16.5 8 12 8Z" />
    </Icon>
  );
}

/** GitHub's mark, filled like the logo rather than drawn in strokes (path from Simple Icons, CC0). */
export function GitHubMark({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
