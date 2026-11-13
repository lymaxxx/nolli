# Nolli → pen.dev

What's here:

| File | Use |
|---|---|
| `INTERFACE.md` | The written brief: layout, every panel and control, behaviour, current visual language, open questions, constraints |
| `nolli-ui.html` (+ `assets/`) | The interface rebuilt as plain HTML: 11 states, each 1360 × 811, real sizes and colours |
| `tokens.json`, `tokens.css` | Colours, sizes and type measured from the running app |
| `screens/` | 13 screenshots of the real app (reference) |

## Import into pen.dev

Not yet tried in pen.dev itself (I can't run it). The steps follow pen.dev's own import docs, and I checked that the HTML renders correctly in a browser.

**1. Editable layers from the HTML (best option)**

From this folder run:

```bash
python3 -m http.server 8765
```

Leave that running, then in the pen.dev desktop app: click the globe icon (built-in browser), enter `http://localhost:8765/nolli-ui.html`, and press **Import**. To bring in one state only, use **Select an element** and click a single window. Check fonts and spacing afterwards. pen.dev warns that imports may differ slightly from the page.

The map backdrop is an image (`assets/map.jpg`); everything else is shapes and text.

**2. Screenshots as reference**

Drag the files from `screens/` onto the canvas. They become image layers to trace over or compare with.

**3. Ask the agent**

In pen.dev's chat (Cmd/Ctrl + K), attach `INTERFACE.md` and the screenshots and ask for a redesign, for example: "Redesign this per INTERFACE.md, keep the three-column layout, address the questions in 'Things worth rethinking'."

**4. Tokens**

`tokens.json` can seed pen.dev **Variables** (colours, sizes). pen.dev's `.pen` format is documented but changes between versions, so I didn't generate one.

## Honest limits

- Screenshots are 1× JPEG, so sampled colours are within a few units of the originals.
- Icons in the HTML are simplified stand-ins for the app's SF Symbols.
- Only light mode is captured.
- The HTML shows the states side by side; it has no behaviour.
