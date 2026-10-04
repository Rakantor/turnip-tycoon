import { z } from 'zod';
import { normalizeCode } from './secrets';

export const profileInput = z
  .object({
    displayName: z.string().trim().max(40),
  })
  .strict();
export const deviceInput = z.object({ deviceName: z.string().trim().min(1).max(60) }).strict();
export const pairingApprovalInput = z
  .object({
    code: z
      .string()
      .max(40)
      .transform(normalizeCode)
      .pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{16}$/)),
  })
  .strict();
export const recoveryInput = z
  .object({
    code: z
      .string()
      .max(80)
      .transform(normalizeCode)
      .pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{32}$/)),
    deviceName: deviceInput.shape.deviceName,
  })
  .strict();
export const emptyInput = z.object({}).strict();
export const deviceIdInput = z.string().uuid();
