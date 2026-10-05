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
