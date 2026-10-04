# Turnip Tycoon icons

`turnip-tycoon-source.webp` preserves the supplied “Cheerful Raccoon Holding a Turnip” artwork as lossless WebP with transparency. The source and store exports stay outside `public/`, so they are not shipped with the website.

Run `pnpm icons:generate` from the repository root to regenerate the assets using the pinned Sharp dependency and [generator](../../scripts/generate-icons.mjs). The generator trims transparent margins and scales the original artwork. Website and browser icons keep transparency; install and store icons use a white background. No rounded corners or exterior shadows are baked into the files.

| Output                | Files                                                       | Format                                           |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| Browser favicon       | `public/favicon.ico`; `public/icons/favicon-{32,48,96}.png` | ICO with 16/32/48px frames; optimized PNG        |
| Website logo          | `public/icons/brand-{96,192,384}.webp`                      | Transparent WebP                                 |
| Apple touch icon      | `public/icons/apple-touch-icon.png`                         | Opaque 180×180 PNG                               |
| PWA icons             | `public/icons/icon-{192,512}.png`                           | Opaque PNG, manifest purpose `any`               |
| PWA maskable icons    | `public/icons/maskable-{192,512}.png`                       | Opaque PNG, manifest purpose `maskable`          |
| Apple App Store / iOS | `exports/app-icons/AppIcon.appiconset/`                     | Xcode catalog with opaque RGB 1024×1024 PNG      |
| Google Play listing   | `exports/app-icons/google-play-512.png`                     | 512×512, 32-bit RGBA PNG with fully opaque alpha |

Web PNGs use palette compression. Store PNGs reduce colors before encoding in the required truecolor formats. The Play export is below its 1024KB limit. Maskable artwork fits within a circle with radius 37% of the canvas width, leaving additional room inside the required 40% safe circle. Regular icons use a larger crop for legibility.

The linked `public/manifest.webmanifest` supplies app metadata and install icons. See [offline setup and verification](../../CONTRIBUTING.md#offline-and-update-verification) for the Pages service worker. Store exports are ready for native packaging; generating them does not create or publish a native app.

The 32px favicon is 1.9 KB, the standard header WebP is 4.9 KB, and the store exports are 298 KB (Apple) and 91 KB (Play). Asset checks cover dimensions, white backgrounds, alpha channels, ICO frames, and maskable safe areas. Build, TypeScript, lint, and formatting pass. Browser checks cover resource responses, manifest parsing, retina selection, and layouts at 320, 390, and 1280 pixels.

References:

- [Apple app icon design](https://developer.apple.com/design/human-interface-guidelines/app-icons) and [Xcode asset catalogs](https://developer.apple.com/documentation/xcode/configuring-your-app-icon): square 1024px iOS source; Xcode generates smaller sizes. The included catalog supplies the standard opaque appearance.
- [Apple touch icon guidance](https://developer.chrome.com/docs/lighthouse/pwa/apple-touch-icon): 180px or 192px with a nontransparent background.
- [Google Play icon specifications](https://developer.android.com/distribute/google-play/resources/icon-design-specifications): 512px, 32-bit PNG, sRGB, at most 1024KB; system-applied masking and shadows.
- [Web manifest maskable icons](https://w3c.github.io/manifest/#icon-masks) and [maskable icon guidance](https://web.dev/articles/maskable-icon): centered circular safe zone with radius 40% of the image width; separate regular and maskable assets.
