# Tacta Score

Snap an overhead photo of a finished Tacta game and get each player's score.

Open the page on your phone, tap **Take photo of the table**, and read the totals. Everything runs on the
phone: the photo is never uploaded or saved, and **Clear game** (with a confirm) wipes it from the page.

To install, open the GitHub Pages URL in Safari, tap Share, then **Add to Home Screen**.

## How it counts

[`src/detect.js`](src/detect.js) finds small, round, solid white blobs that are clearly brighter than their
surroundings. It then checks the ring of pixels around each one. A scoring dot sits inside a solid colored
shape, so its ring is one card color. White symbols on black, number badges, and the start card fail that
test. Each dot is scored for the color around it.

## Developing

```bash
sips -s format bmp photo.HEIC --out photo.bmp
node tools/run.mjs photo.bmp overlay.bmp   # prints scores, writes a debug overlay
```
