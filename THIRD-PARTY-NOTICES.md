# Third-party UI sources

The local soft-light UI adapts small HTML/CSS interaction patterns from
[Uiverse Galaxy](https://github.com/uiverse-io/galaxy), under the MIT License.
Downloaded originals are retained separately at
`E:\Codex工作盘\downloads\source-packages\uiverse-20261019`.
No third-party JavaScript or hosted widgets are executed by the application.

## Adapted elements

- [adamgiebl / soft-gecko-85](https://uiverse.io/adamgiebl/soft-gecko-85): layered pill button and hover scaling, adapted in `apps/web/src/controls.css`. Reduced to subtle blue-violet highlights; fixed hit area and reduced-motion support.
- [vinodjangid07 / funny-panther-79](https://uiverse.io/vinodjangid07/funny-panther-79): anchored tooltip, adapted in `apps/web/src/ui.tsx` and `controls.css`. Added keyboard focus, Escape dismissal, ARIA relationships and hover persistence; removed jello animation.
- [alexruix / jolly-emu-80](https://uiverse.io/alexruix/jolly-emu-80): rounded input focus/hover border transitions, adapted in `controls.css`. Retained visible focus rings, existing labels and form semantics.
- [mrhyddenn / old-fish-66](https://uiverse.io/mrhyddenn/old-fish-66): checkbox-controlled sliding switch, adapted in `apps/web/src/create/creation.css`. Kept native, keyboard-focusable input and existing state handling.

Copyright (c) 2026 adamgiebl, vinodjangid07, alexruix, mrhyddenn
(individual Uiverse elements).

## MIT License

Copyright (c) 2023 Uiverse.io

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
