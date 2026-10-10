import './player-avatar.css';

export function PlayerAvatar({ name, small = false }: { name: string; small?: boolean }) {
  const letters = name
    .split(/[\s-]+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return (
    <span className={`player-avatar${small ? ' player-avatar-small' : ''}`} aria-hidden="true">
      {letters}
    </span>
  );
}
