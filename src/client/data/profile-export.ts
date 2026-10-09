import {
  EXPORT_SECTIONS,
  type ExportSection,
  type ProfileExportPage,
} from '../../shared/profile-data';
import { t } from '@lingui/core/macro';
import type { TurnipDatabase } from './database';
import { CONTACT_EMAIL } from '../../shared/contact';

export async function collectProfileExport(
  owner: string,
  deps: {
    db: TurnipDatabase;
    savePending: () => Promise<void>;
    current: () => boolean;
    page: (section: ExportSection, after?: string) => Promise<ProfileExportPage>;
  },
) {
  const startedAt = new Date().toISOString();
  const check = () => {
    if (!deps.current()) throw new Error(t`Your profile changed. Please start the download again.`);
  };
  check();
  await deps.savePending();
  const localWeeks = await deps.db.weeks.where('owner').equals(owner).toArray();
  const records: Record<ExportSection, unknown[]> = {
    devices: [],
    groups: [],
    weeks: [],
    pairing: [],
    syncRecords: [],
  };
  let metadata: ProfileExportPage | undefined;
  for (const section of EXPORT_SECTIONS) {
    let cursor: string | undefined;
    do {
      check();
      const page = await deps.page(section, cursor);
      check();
      if (
        page.profile.id !== owner ||
        page.section !== section ||
        (page.nextCursor && cursor && page.nextCursor <= cursor)
      )
        throw new Error(t`The download could not be completed. Please try again.`);
      metadata ??= page;
      records[section].push(...page.records);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  check();
  return {
    format: 'turnip-tycoon-profile',
    version: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    notes: [
      'Server records are read in batches during this download, not as a single point-in-time snapshot.',
      'localWeeks contains this device’s saved copy, including unsynced changes and unresolved conflicts. It is separate from server records.',
      'Access tokens, recovery secrets, their verifiers, group invite codes, and other players’ records are excluded.',
      `Provider logs, backups, and support emails are not in the app database. Contact ${CONTACT_EMAIL} about those records.`,
      'Week dates start on Sunday. Server selling days run from 1 (Monday) to 6 (Saturday), with AM/PM slots. Local price arrays run from Monday AM to Saturday PM.',
    ],
    profile: metadata!.profile,
    hasRecoveryCode: metadata!.hasRecoveryCode,
    server: records,
    localWeeks,
  };
}
