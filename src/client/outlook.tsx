import { Leaf } from 'lucide-react';
import type { Advice } from './advice';
import { assetUrl } from './urls';

export function Outlook({ advice }: { advice: Advice }) {
  return (
    <section className="outlook" aria-label="This week’s advice">
      <div className="outlook-bubble">
        <img
          className="outlook-mascot"
          src={assetUrl('icons/brand-192.webp')}
          srcSet={`${assetUrl('icons/brand-192.webp')} 192w, ${assetUrl('icons/brand-384.webp')} 384w`}
          sizes="(max-width: 720px) 76px, (max-width: 999px) 128px, 190px"
          width={190}
          height={190}
          alt=""
        />
        <p className="outlook-eyebrow">{advice.eyebrow}</p>
        <p className="outlook-message" aria-live="polite">
          {advice.lead}
          {advice.highlight && <mark>{advice.highlight}</mark>}
          {advice.trail}
        </p>
        {advice.chips.length > 0 && (
          <ul className="outlook-chips">
            {advice.chips.map((chip) => (
              <li key={chip.text} className={`chip chip-${chip.tone}`}>
                {chip.tone === 'leaf' && <Leaf size={15} aria-hidden="true" />}
                {chip.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
