# VirtualRainbow — Claude Context

Passion project — virtual worlds, experiences & collectibles for brands in Web3/metaverse. Building in The Otherside using MML (Metaverse Markup Language).

Vision & notes: `C:/Users/Anders/Documents/mybrain/01_Projects/VirtualRainbow/VirtualRainbow_Virtual_Worlds.md`

---

## How to Run

```bash
start_server.bat   # serves site at http://localhost:8080
```

Or manually: open `index.html` via any static file server.

---

## Key Files

- `index.html` — main page
- `script.js` — site logic
- `styles.css` — styling
- `holographic_character.glb` — hero GLB character (holographic effect in hero section)
- `start_server.bat` — starts local server on port 8080

---

## Stack

- Static HTML/CSS/JS — no framework
- Three.js / WebGL for the holographic GLB character
- Hosted locally via `start_server.bat`

---

## Gotchas

- The hero holographic character is a GLB file — keep it optimised (max 50k tris, 2048px textures for Otherside compatibility)
- No build step — changes to HTML/CSS/JS are live immediately on refresh

---

## Current Focus

- Website is a placeholder/showcase
- Main action is in MML world experiments: `C:/Users/Anders/Documents/projects/mml-starter-project/`
- Full concept library: `C:/Users/Anders/Documents/mybrain/01_Projects/Otherside_Builds/Concepts.md`
