# Approved Reference Video Analysis

## File identity

- Bundled asset: `assets/approved-opening-video.mp4`
- Original user file: `D:\桌面\视频节点 15.mp4`
- File size: `3,766,301 bytes`
- SHA-256: `EB03AF241C623989C7BF4A607BF18D20955F244D10587585E4745F1BD335931D`

## Media metadata

- Container: MP4/isom
- Total duration: `6.080000 s`
- Video duration: `6.041667 s`, `145 frames`
- Resolution: `480 × 854`, vertical
- Frame rate: constant `24 fps`, progressive
- Video: H.264/AVC High Profile Level 3.0, `avc1`, `yuv420p`
- Audio: AAC-LC stereo, `32,000 Hz`, total audio duration `6.080000 s`

## Observable timing anchors

1. `0.00–0.65 s` — Warehouse aisle. The customer is on frame-left, wearing a backward cap, sunglasses and a loose gray T-shirt while holding an orange drink. He opens his mouth in surprise, then raises his free hand to cover it.
2. `0.65–1.75 s` — His gaze motivates a fast horizontal pan to the right. Shelves, ceiling lights and displays create horizontal motion blur while the shot remains one continuous take.
3. `1.75–about 5.15 s` — The camera settles centrally on one adult male and one adult female employee in blue workwear behind a blue pallet. Both hold the same white sheet. This interval contains their visible mouth and restrained head-and-shoulder countdown rhythm; the sheet keeps the products covered.
4. `about 5.17–5.75 s` — Both employees pull the sheet upward together. The cloth first tightens, then forms natural folds and an upward wave while the product display is revealed from bottom to top.
5. `about 5.75–6.08 s` — The reference shows a regular wall of approximately 18 white-and-green cartons in a `6 × 3` layout. Both employees smile and hold the sheet overhead for the final hero frame.

The reference carton count is descriptive, not a permanent rule. Future product count and layout come from the supplied product image or downstream script parameters.

## Normative countdown timing for regeneration

The source video establishes the visible action windows; the following word windows are the production targets for a new generation, not a claim of transcript-level source timing:

| Beat | 6.08-second match | 8-second fallback |
|---|---:|---:|
| Customer reaction | 0.00–0.65 s | 0.00–0.85 s |
| Rightward whip pan | 0.65–1.75 s | 0.85–2.30 s |
| Camera settles, employees ready | 1.75–2.10 s | 2.30–2.75 s |
| Both say `Three` and pulse the sheet | 2.10–2.70 s | 2.75–3.55 s |
| Both say `Two` and pulse the sheet | 3.15–3.70 s | 4.15–4.87 s |
| Both say `One`; final sound preloads the lift | 4.30–5.15 s | 5.66–6.78 s |
| Upward reveal | 5.17–5.75 s | 6.80–7.55 s |
| Stable hero hold | 5.75–6.08 s | 7.55–8.00 s |

For any other duration, use proportional scaling as a starting point while keeping the lift onset attached to the final sound of `One`. Preserve the silent spacing between the three spoken beats rather than stretching each word unnaturally. When the target is 8 seconds or longer, reserve at least `0.45 s` for the stable hero hold even if that requires shortening the reveal slightly.

## Bundled ending frame

- Asset: `assets/approved-opening-final-frame.png`
- Exact source frame: video frame `144` of `145` (zero-based), timestamp `6.000000 s`
- SHA-256: `E803A7A18BFB69CE26F23B26D75CEEF2CEBEA95B83277F54891675265781E449`

This is the literal last decoded video frame, not a recreated still. Use it to compare framing and ending state; regenerate an actual ending frame from every newly rendered opening before handing off to the next module.

## Locked causal chain

`customer surprise → gaze-motivated rightward whip pan → two employees hold the sheet and count down → one synchronized upward reveal → centered product wall and smiling raised-sheet end frame`
