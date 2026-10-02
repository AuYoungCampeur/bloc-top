# Local PWA fonts

Plus Jakarta Sans and JetBrains Mono variable upright fonts, from the official Google Fonts repository at commit `9710da1eacb3be272583c3224dcb70f9da6eadbb`. Their SIL Open Font License notices are included beside the binaries.

- [PlusJakartaSans.ttf](https://raw.githubusercontent.com/google/fonts/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf), 176,288 bytes, SHA256 `89b3fb38aa0d275d7a731d0d817a4f1622b316b4d7fbdedcf02ee9099ff68bc8`.
- [JetBrainsMono.ttf](https://raw.githubusercontent.com/google/fonts/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf), 187,208 bytes, SHA256 `48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda`.

Bundling the fonts makes builds independent of live Google Fonts CSS and file downloads. `next/font/local` still emits optimized app assets.
