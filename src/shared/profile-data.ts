import type { Player } from './api';

export const EXPORT_SECTIONS = ['devices', 'groups', 'weeks', 'pairing', 'syncRecords'] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

/** Bounded pages keep large histories out of the Worker's memory at once. */
export interface ProfileExportPage {
  profile: Player;
  hasRecoveryCode: boolean;
  section: ExportSection;
  records: unknown[];
  nextCursor: string | null;
}

export type ProfileRemoval = {
  owner: string;
  phase: 'pending' | 'deleted' | 'disconnected';
};
