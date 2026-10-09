import { t } from '@lingui/core/macro';

/**
 * The API answers in English. Each message it can send is translated here, keyed by its
 * exact text; tests/client/server-messages.test.ts keeps this list in step with the server.
 */
export function serverMessages(): Record<string, string> {
  return {
    'Approve this code from a connected device first.': t`Approve this code from a connected device first.`,
    'Choose a valid Sunday for this week.': t`Choose a valid Sunday for this week.`,
    'Choose a valid device.': t`Choose a valid device.`,
    'Choose a valid export page.': t`Choose a valid export page.`,
    'Choose a valid group or player.': t`Choose a valid group or player.`,
    'Choose a valid history date and limit.': t`Choose a valid history date and limit.`,
    'Check the supplied fields.': t`Check the supplied fields.`,
    'Connect a device to continue.': t`Connect a device to continue.`,
    'Open this request from the app.': t`Open this request from the app.`,
    'Please try connecting again.': t`Please try connecting again.`,
    'Please try creating the group again.': t`Please try creating the group again.`,
    'Send a JSON request body.': t`Send a JSON request body.`,
    'Send a JSON request.': t`Send a JSON request.`,
    'Send valid JSON.': t`Send valid JSON.`,
    'The request body could not be read.': t`The request body could not be read.`,
    'The request is too large.': t`The request is too large.`,
    'This browser is connected to a different player.': t`This browser is connected to a different player.`,
    'This browser request is not allowed.': t`This browser request is not allowed.`,
    'This device is no longer available.': t`This device is no longer available.`,
    'This device is no longer connected.': t`This device is no longer connected.`,
    'This device’s access expired. Reconnect your profile.': t`This device’s access expired. Reconnect your profile.`,
    'This group code is not available. Check the code and try again.': t`This group code is not available. Check the code and try again.`,
    'This group is full. A group can have up to 8 players.': t`This group is full. A group can have up to 8 players.`,
    'This group is no longer available to you.': t`This group is no longer available to you.`,
    'This pairing code expired or is no longer available. Start again on the new device.': t`This pairing code expired or is no longer available. Start again on the new device.`,
    'This pairing code has already been approved.': t`This pairing code has already been approved.`,
    'This pairing code is no longer available.': t`This pairing code is no longer available.`,
    'This player is no longer available to you.': t`This player is no longer available to you.`,
    'This player is no longer available.': t`This player is no longer available.`,
    'This recovery code is invalid or has already been replaced.': t`This recovery code is invalid or has already been replaced.`,
    'This save request was already used for a different edit.': t`This save request was already used for a different edit.`,
    'Use HTTPS to connect securely.': t`Use HTTPS to connect securely.`,
    'You no longer share a group with this player.': t`You no longer share a group with this player.`,
    'Your profile changed. Review it before deleting.': t`Your profile changed. Review it before deleting.`,
  };
}

/** The message in the reader's language; one the app doesn't know yet stays as sent. */
export function serverMessage(message: string): string {
  return serverMessages()[message] ?? message;
}
