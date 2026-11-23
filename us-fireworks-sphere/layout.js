// Both renderers use the same photo centers, framing and depth cues.
window.projectFireworkTile = function (tile, orientation, view, spacing) {
  const [x, y, z] = tile.point;
  const m = orientation;
  const originalZ = m[6] * x + m[7] * y + m[8] * z;
  tile.z = originalZ * spacing;
  tile.inverseP = 1 - tile.z / view.distance;
  tile.gx = (m[0] * x + m[1] * y + m[2] * z) * spacing - view.center[0] * tile.inverseP;
  tile.gy = (m[3] * x + m[4] * y + m[5] * z) * spacing - view.center[1] * tile.inverseP;

  // Base photo size and brightness follow the original relative depth.
  // Changing spacing therefore moves centers without also resizing the tiles.
  const depth = Math.max(0, Math.min(1, (originalZ + 0.99) / 2));
  tile.side = 6 + 21.5 * depth ** 1.25;
  const light = 0.36 + 0.64 * depth ** 0.85;
  tile.shade = light >= 0.99 ? 0 : 1 - light;
};
