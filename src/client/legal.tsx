import { useEffect, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { CONTACT_EMAIL } from '../shared/contact';
import './legal.css';

export function isLegalPath(pathname: string): boolean {
  return /^\/(?:privacy|terms)\/?$/i.test(pathname);
}

function Contact() {
  return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
}

function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Turnip Tycoon`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  return (
    <main className="page legal-page" id="main-content">
      <nav className="segmented-control legal-navigation" aria-label="Terms and privacy">
        <NavLink to="/terms">Terms</NavLink>
        <NavLink to="/privacy">Privacy</NavLink>
      </nav>
      <article className="legal-document">
        <header>
          <h1>{title}</h1>
          <p className="legal-intro">{intro}</p>
          <p className="legal-date">
            Last updated <time dateTime="2026-10-06">6 October 2026</time>
          </p>
        </header>
        {children}
      </article>
    </main>
  );
}

export function Terms() {
  return (
    <LegalPage
      title="Terms of use"
      intro="A few ground rules for a small community of turnip traders."
    >
      <section aria-labelledby="terms-about">
        <h2 id="terms-about">What this app is</h2>
        <p>
          Turnip Tycoon is a free fan project run by Rakantor. It helps you track Animal Crossing:
          New Horizons turnip prices, see forecasts, log your in-game trades, and compare prices
          with friends. It isn’t affiliated with or endorsed by Nintendo.
        </p>
        <p>
          Questions or problems? Email <Contact />. The <Link to="/privacy">Privacy page</Link>{' '}
          explains what happens to your data.
        </p>
      </section>

      <section aria-labelledby="terms-forecasts">
        <h2 id="terms-forecasts">Forecasts can be wrong</h2>
        <p>
          Forecasts are estimates based on the prices you enter. Typos, missing prices, or game
          updates can throw them off, and a possible top price is never a promise. Check the price
          in your game before you sell. The decision is yours, and we can’t make up for lost bells
          or turnips. Friends’ prices are entered by them and may be out of date.
        </p>
      </section>

      <section aria-labelledby="terms-access">
        <h2 id="terms-access">Look after your profile</h2>
        <p>
          You don’t need an email address or password. Continuing from the welcome screen creates a
          profile that this device remembers. Your friend code is public; your recovery code is not.
          Keep it private, and only approve devices you trust. If you clear your browser data or
          lose your device without another connected device or a recovery code, we may not be able
          to get your profile back.
        </p>
        <p>
          If you’re too young to agree to these terms where you live, ask a parent or guardian to
          help. You never need to share your real name, age, address, or Nintendo account here.
        </p>
      </section>

      <section aria-labelledby="terms-community">
        <h2 id="terms-community">Be kind to other players</h2>
        <ul>
          <li>Pick names that are fine for players of all ages.</li>
          <li>Don’t impersonate, harass, scam, or mislead other players.</li>
          <li>
            Only share group invites with people you want in the group. Anyone with an invite can
            see the group’s members and join while there’s room (
            <Link to="/privacy#sharing">who can see what</Link>).
          </li>
          <li>Don’t post other people’s private information or try to get into their profile.</li>
          <li>Don’t attack or overload the app, or try to get around its security.</li>
        </ul>
        <p>
          We may remove names or restrict access when that’s needed to protect players, keep the app
          running, or follow the law. If you think we got it wrong, tell us.
        </p>
      </section>

      <section aria-labelledby="terms-availability">
        <h2 id="terms-availability">No guarantees</h2>
        <p>
          The app is free and provided as it is. We try to keep it running and accurate, but can’t
          promise it will always be available, error-free, or keep your data forever. Features may
          change, and the project may close one day. If that affects your saved data, we’ll try to
          warn you in the app first.
        </p>
        <p>
          Edits made offline reach the server once you’re back online with the app open. Until then,
          they exist only on that device.
        </p>
        <p>
          Nothing here takes away rights you have by law. These limits don’t apply where the law
          doesn’t allow them, for example to harm caused on purpose or through gross negligence.
        </p>
      </section>

      <section aria-labelledby="terms-content">
        <h2 id="terms-content">Your content and our code</h2>
        <p>
          Your names and records stay yours. You let us store and show them as needed to run the
          features you use, such as sharing your island prices with your groups. We don’t use them
          for anything else.
        </p>
        <p>
          The app’s original code and materials are licensed under the Apache License 2.0. Other
          components keep their own licenses, listed in the footer. Animal Crossing and Nintendo are
          trademarks of their owners.
        </p>
      </section>

      <section aria-labelledby="terms-changes">
        <h2 id="terms-changes">Leaving, and changes to these terms</h2>
        <p>
          You can stop using the app at any time. Uninstalling it or removing a device doesn’t
          delete your data from our server. To do that, use{' '}
          <Link to="/settings#your-data">Settings → Your data → Delete my profile</Link>.
        </p>
        <p>
          If these terms change, we’ll update the date at the top and show a notice in the app for
          important changes. Changes never apply to the past, and if a change legally needs your
          agreement, we’ll ask for it.
        </p>
      </section>
    </LegalPage>
  );
}

export function Privacy() {
  return (
    <LegalPage title="Privacy" intro="What we save, who can see it, and what you can do about it.">
      <aside className="legal-summary" aria-labelledby="privacy-summary">
        <h2 id="privacy-summary">In short</h2>
        <ul>
          <li>No email or password needed. A nickname is enough, or none at all.</li>
          <li>
            We save your turnip prices, optional trade records, and groups so they sync between your
            devices.
          </li>
          <li>
            <Link to="/privacy#sharing">Friends in your groups</Link> see your island prices, never
            your purchases, sales, or profit.
          </li>
          <li>No ads, no tracking, and we never sell your data.</li>
          <li>
            Download or delete everything at any time in{' '}
            <Link to="/settings#your-data">Settings → Your data</Link>.
          </li>
          <li>
            Questions? Email <Contact />.
          </li>
        </ul>
      </aside>

      <section aria-labelledby="what-we-save">
        <h2 id="what-we-save">What we save</h2>
        <p>
          When you continue from the welcome screen, we create a profile for you. Just reading these
          pages doesn’t create one.
        </p>
        <ul>
          <li>
            <strong>Your profile:</strong> a generated player ID, your public friend code, and a
            display name. If you skip the name, we use part of your friend code.
          </li>
          <li>
            <strong>Your weeks:</strong> your Sunday buying price, your selling prices through the
            week, and your forecast settings.
          </li>
          <li>
            <strong>Trade records (optional):</strong> how many turnips you bought and sold, at what
            price, and when. These are in-game records, never real money.
          </li>
          <li>
            <strong>Groups:</strong> group names, invite codes, and who is a member.
          </li>
          <li>
            <strong>Devices:</strong> a name such as “My phone”, when each device was connected, and
            when its access expires. Access secrets and codes are only stored in a protected,
            unreadable form.
          </li>
          <li>
            <strong>Sync details:</strong> version numbers that stop edits being saved twice or lost
            between devices.
          </li>
        </ul>
        <p>
          Our providers also see technical details when your browser connects, such as your IP
          address. If you email us, we receive your email address and message. Please never send
          your recovery code.
        </p>
      </section>

      <section aria-labelledby="privacy-purposes">
        <h2 id="privacy-purposes">Why we use it</h2>
        <p>
          Only to run the app: saving and syncing your prices, showing forecasts and groups, and
          helping you get back into your profile. We also use short-lived technical logs to keep the
          app secure and fix errors, and your emails to answer you. Forecasts are calculated in your
          browser. We don’t use analytics or make automated decisions about you.
        </p>
      </section>

      <section aria-labelledby="sharing">
        <h2 id="sharing">Who can see it</h2>
        <ul>
          <li>
            <strong>People in your groups</strong> see your display name, friend code, and your
            current and past island prices with their forecasts. They can’t see your purchases,
            sales, or profit, and they can’t edit anything.
          </li>
          <li>
            <strong>Anyone with a group invite</strong> can see the group’s name and its members’
            names, and can join while there’s room. Only share invites with people you trust.
          </li>
          <li>
            <strong>Your connected devices</strong> can see everything in your profile, including
            your trades, and so can anyone using them.
          </li>
          <li>
            <strong>We and the services below</strong> handle your data only to run and protect the
            app, or when the law requires it.
          </li>
        </ul>
        <p>
          Leaving a group stops its members seeing your prices, unless you share another group. We
          can’t take back screenshots or copies someone already made, and a friend’s offline screen
          may show old prices until it refreshes.
        </p>
      </section>

      <section aria-labelledby="privacy-providers">
        <h2 id="privacy-providers">Services we use</h2>
        <ul>
          <li>
            <strong>GitHub Pages</strong> delivers the app’s website and records visitors’ IP
            addresses for security.
          </li>
          <li>
            <strong>Cloudflare</strong> runs the server the app talks to.
          </li>
          <li>
            <strong>Supabase</strong> hosts our database in the European Union.
          </li>
          <li>
            <strong>Gmail</strong> (Google) receives the emails you send us.
          </li>
        </ul>
        <p>
          Some of these companies can access data from outside the EU, mainly from the United
          States. GitHub, Cloudflare, and Google are certified under the EU-U.S. Data Privacy
          Framework, and Supabase uses the EU’s standard contractual clauses. More details are in
          the privacy policies of{' '}
          <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">
            GitHub
          </a>
          , <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare</a>,{' '}
          <a href="https://supabase.com/privacy">Supabase</a>, and{' '}
          <a href="https://policies.google.com/privacy">Google</a>.
        </p>
      </section>

      <section aria-labelledby="privacy-retention">
        <h2 id="privacy-retention">How long we keep it</h2>
        <ul>
          <li>
            <strong>Your profile and history</strong> stay until you delete your profile. We don’t
            delete inactive profiles. A group is deleted when its last member leaves.
          </li>
          <li>
            <strong>Deleting your profile</strong> removes it from our database straight away. There
            are no database backups, so no older copy is left behind.
          </li>
          <li>
            <strong>Server logs</strong> can include your IP address and the profile or group IDs in
            a request. Cloudflare keeps them for 3 days and Supabase for 1 day. GitHub keeps its own
            security logs under its privacy policy.
          </li>
          <li>
            <strong>Support emails</strong> are deleted within a month after your request is
            resolved.
          </li>
          <li>
            <strong>Device access</strong> ends after 30 days without using the app online, and
            using it online renews it. Pairing codes expire after 10 minutes. Expired access doesn’t
            delete your records.
          </li>
        </ul>
      </section>

      <section aria-labelledby="storage">
        <h2 id="storage">What stays on your device</h2>
        <p>
          The app saves your profile access, your weeks and trades, unsent edits, and the latest
          prices from your groups in your browser’s storage, so it works offline. These are needed
          for the app to work. We don’t use advertising or analytics cookies.
        </p>
        <p>
          Clearing your browser data removes these copies, possibly including unsent edits and your
          access, but doesn’t delete anything from our server. If your profile is deleted or a
          device is removed, each device clears its saved copy the next time it goes online. If
          access only expired, your saved prices stay on the device until you reconnect.
        </p>
      </section>

      <section aria-labelledby="your-choices">
        <h2 id="your-choices">Your choices and rights</h2>
        <p>
          In <Link to="/settings#your-data">Settings → Your data</Link>:
        </p>
        <ul>
          <li>
            <strong>Download my data</strong> gives you a file with your profile, devices, groups,
            and all your prices and trades, plus anything this browser hasn’t synced yet. Access
            secrets and other players’ data are left out.
          </li>
          <li>
            <strong>Delete my profile</strong> permanently removes your profile, prices, trades,
            devices, recovery code, and group memberships. Groups with other members stay. You’ll be
            asked to confirm, and it can’t be undone.
          </li>
        </ul>
        <p>
          Both need an internet connection. Bring your other devices online first if you want their
          latest edits in the download. In the app you can also change your name, edit this and last
          week’s prices, leave groups, and remove devices.
        </p>
        <p>
          Under the GDPR, you can also ask us to show, correct, delete, or hand over your data, or
          to limit or stop using it. Email <Contact /> for anything the app can’t do. It’s free, and
          we’ll answer within a month. Never send secret codes, and please don’t post requests in
          public. If you’ve lost every device and your recovery code, we may not be able to tell
          which profile is yours.
        </p>
        <p>
          You can also complain to a{' '}
          <a href="https://www.edpb.europa.eu/about-edpb/about-edpb/members_en">
            data protection authority
          </a>
          , especially where you live or work.
        </p>
      </section>

      <section aria-labelledby="privacy-operator">
        <h2 id="privacy-operator">Legal details</h2>
        <p>
          Turnip Tycoon is run by Rakantor, who is responsible for your data under the GDPR (the
          “controller”). Contact: <Contact />.
        </p>
        <ul>
          <li>
            Running the app and answering your messages: needed to provide the service you asked for
            (Article 6(1)(b)).
          </li>
          <li>
            Security logs and fixing errors: our legitimate interest in a safe, working app (Article
            6(1)(f)). You can object to this.
          </li>
          <li>Handling rights requests: our legal obligation (Article 6(1)(c)).</li>
        </ul>
        <p>
          You don’t have to use a real name, record trades, or join groups. Without a profile, we
          can’t save or sync your prices.
        </p>
      </section>

      <section aria-labelledby="privacy-updates">
        <h2 id="privacy-updates">Changes to this page</h2>
        <p>
          If this page changes, we’ll update the date at the top. Before any important change to how
          we use or share your data, we’ll show a notice in the app, and ask for your consent where
          the law requires it.
        </p>
      </section>
    </LegalPage>
  );
}
