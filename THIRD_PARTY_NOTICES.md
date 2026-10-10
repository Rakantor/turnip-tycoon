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

The interface bundles the Latin subsets of two variable fonts, and Nunito's Cyrillic
subset, installed from the [Fontsource](https://fontsource.org) packages
`@fontsource-variable/fredoka` and `@fontsource-variable/nunito`. Both are licensed under
the SIL Open Font License, Version 1.1, and their licenses are included in the built
website's public assets:

- [Fredoka](https://github.com/hafontia/Fredoka-One), copyright 2016 The Fredoka Project Authors: [license](public/licenses/fonts/Fredoka-OFL.txt)
- [Nunito](https://github.com/googlefonts/nunito), copyright 2014 The Nunito Project Authors: [license](public/licenses/fonts/Nunito-OFL.txt)

For Japanese, Korean and Chinese it bundles four more fonts under the same license, cut down
to the characters the app's text uses. `scripts/subset-fonts.ts` downloads the originals
pinned in `scripts/font-subsets.ts` and keeps each font's copyright and license fields in its
subset:

- [M PLUS Rounded 1c](https://github.com/google/fonts/tree/main/ofl/mplusrounded1c), copyright 2016 The Rounded M+ Project Authors: [license](public/licenses/fonts/MPLUSRounded1c-OFL.txt)
- [Jua](https://github.com/google/fonts/tree/main/ofl/jua), copyright 2018 The Jua Project Authors: [license](public/licenses/fonts/Jua-OFL.txt)
- [Resource Han Rounded](https://github.com/CyanoHao/Resource-Han-Rounded), copyright 2018–2022 Cyano Hao, portions copyright 2014–2021 Adobe with Reserved Font Name 'Source': [license](public/licenses/fonts/ResourceHanRounded-OFL.txt)
- [Huninn](https://github.com/justfont/Huninn), copyright 2025 The Huninn Project Authors: [license](public/licenses/fonts/Huninn-OFL.txt)
