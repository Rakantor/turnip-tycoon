import { i18n } from '@lingui/core';
import { messages } from '../../src/client/locales/en.po';

// Client code reads its English text through Lingui, as the app does before it renders.
i18n.loadAndActivate({ locale: 'en', messages });
