// The Lingui Vite plugin compiles imported catalogs into their messages.
declare module '*.po' {
  import type { Messages } from '@lingui/core';
  export const messages: Messages;
}
