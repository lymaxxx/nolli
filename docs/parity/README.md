# Label parity with the macOS app

The web app's label placement is a port of `LabelLayoutEngine` (`macos/Nolli/Views/LabelRendering.swift`). It is checked against the macOS app by comparing the two layouts. Nothing here has been run against a real macOS dump yet.

## Producing a dump (needs a Mac)

`LayoutDump.swift` in this folder writes the macOS app's label layout as JSON: every road name (with its street's geometry, centre distance and width), point label and icon, in artwork space. It has not been compiled. The steps to add it are in the comment at the top of the file. It is kept outside `macos/` so it cannot break the Mac build until you add it.

Dump each real project once, at its own base zoom with label scale 1. Keep the dumps out of the repository if the projects are client work.

## Comparing

`compareLayouts(dump, layout, tolerance)` in `web/packages/core/src/layout/compare.ts` matches items by layer, feature and text, in order along each street, and reports what is missing, extra, or further apart than the tolerance (default 2 artwork pixels). Layout does not depend on zoom or rotation, so one dump is enough.

To use it, load the project with `loadProject`, run `computeLabelLayout` with a `TextMeasurer`, and pass both to `compareLayouts`.

## Read this before trusting a comparison

- **Fonts decide widths, and widths decide placement.** The web app currently resolves every project font to Noto Sans (see `apps/editor/src/map/fonts.ts`), so label widths differ from the macOS app's, and positions will drift with them. Until the font-mapping dialog exists, or the comparison is run with the same font on both sides, expect the *set* of labelled streets to be close and the positions not to be.
- **HarfBuzz and CoreText agree closely but not exactly** on advances and kerning, and the ascent and descent come from different font tables. The tolerance exists for that.
- **Two deliberate differences.** Whole words of joined scripts (Arabic and others) are placed as one rigid piece and rejected on a bend their length cannot follow; the macOS app would draw such a word letter by letter and break its joins. And rectangles that only touch are treated as not intersecting (an assumption about `CGRect.intersects`; it only matters at exact floating-point ties).
