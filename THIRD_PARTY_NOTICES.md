# Third-party notices

The local turnip prediction engine includes modified code from
[Turnip Prophet](https://github.com/mikebryant/ac-nh-turnip-prices), originally
developed by Mike Bryant, with great thanks to Ninji.

Copyright 2020 Mike Bryant. Licensed under the Apache License, Version 2.0.

The upstream revision is `c7b7ab3614faf61686da3c535cf204ef568d4cdb`.
The vendored file is `src/prediction/vendor/predictions.js`. Its header identifies
our modifications; the audit and unresolved limitations are recorded in
[the engine audit](src/prediction/UPSTREAM_AUDIT.md).

The following upstream files are preserved verbatim and included in the built
website's public assets:

- [Apache 2.0 LICENSE](public/licenses/turnip-prophet/LICENSE)
- [NOTICE](public/licenses/turnip-prophet/NOTICE)
- [COPYRIGHT](public/licenses/turnip-prophet/COPYRIGHT)

The public attribution should link to Turnip Prophet and the included license.

## Fonts

The interface bundles the Latin subsets of two variable fonts, installed from the
[Fontsource](https://fontsource.org) packages `@fontsource-variable/fredoka` and
`@fontsource-variable/nunito`. Both are licensed under the SIL Open Font License,
Version 1.1, and their licenses are included in the built website's public assets:

- [Fredoka](https://github.com/hafontia/Fredoka-One), copyright 2016 The Fredoka Project Authors: [license](public/licenses/fonts/Fredoka-OFL.txt)
- [Nunito](https://github.com/googlefonts/nunito), copyright 2014 The Nunito Project Authors: [license](public/licenses/fonts/Nunito-OFL.txt)
