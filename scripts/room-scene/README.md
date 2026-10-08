# Room scene

`/room` draws the CTO room from `apps/web/src/features/room/assets/scene-v4.json`: the 3D
model's meshes and boxes in world millimetres, and nothing else. Names and addresses come from
the drawer plan (`apps/web/src/features/panel/layout/drawer-plan-v4.json`), stock from IMS.

The 3D model and its renderer are maintained outside this repository. The renderer's preview page
embeds the scene as `<script type="application/json" id="scene-data">`, and
`extract-scene.mjs` turns that into the asset.

## When the cabinets change

1. Get the new renderer preview page (`CTO_Room_Inventory_Finder_v<N>-preview.html`).
2. If the drawer plan changed too, update `drawer-plan-v<N>.json` first (see
   `apps/web/src/features/panel/layout.ts`). The scene is checked against the plan, not the other way round.
3. Extract:

   ```bash
   node scripts/room-scene/extract-scene.mjs <path-to>/CTO_Room_Inventory_Finder_v4-preview.html
   ```

   It refuses to write anything if the scene and the plan disagree about a drawer, a cell or a
   cell's box, and lists every difference. `--check` writes nothing and fails if the committed
   file is not what the page produces.
4. `pnpm --filter @ims/web test src/features/room` — the model test checks the 148 cells plus LB and
   LR against the 150 rows of `ims-import-v4.csv` in both directions, the front-row orientation in
   every drawer, and that the asset carries no text (K2).

A new plan version is a new file (`scene-v5.json`), imported in `features/room/api.ts`.

## What the asset holds

`format` (1; `features/room/scene/asset.ts` refuses any other), `plan` (the plan version it was
checked against), the room's box, the shell (walls), the cabinets with their parts, drawers and
cell boxes, the opening direction and slide of each cabinet, and the decor (desk, shelving). Mesh
data is base64: int16 positions in half millimetres, int8 normals, uint16 or uint32 indices.

The drawer-body colours are set in the renderer's code rather than its scene data, so the
extractor writes them into the asset; `/room` has no colour literals of its own.

The file is about 1.1 MB, 380 KB gzipped. It is fetched once per page load from a content-hashed
URL under `/assets/`, which nginx serves gzipped with a one-year immutable cache.
