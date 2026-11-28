(() => {
  "use strict";

  function distributeMatrix(matrix, removedGroup) {
    const labels = matrix.labels.filter((_, group) => group !== removedGroup);
    const groups = matrix.groups.map(group => group - Number(group > removedGroup));
    const assigned = labels.map(() => []);
    const photos = labels.map(() => []);
    let nextCity = 0;
    matrix.groups.forEach((group, i) => {
      if (group === removedGroup) {
        const city = nextCity++ % labels.length;
        groups[i] = city;
        assigned[city].push(matrix.photoIds[i]);
      }
      photos[groups[i]].push(i);
    });

    const rects = new Array(matrix.rects.length);
    const columnPitch = 60;
    const rowPitch = 42;
    const columnGap = 78;
    const rowGap = 210;
    const margin = 140;
    let top = margin;
    let widestRow = 0;
    // Keep the cities in reading order when moving the fifth group to the lower row.
    for (const [start, end, rowCount] of [[0, 4, 24], [4, labels.length, 20]]) {
      let left = margin;
      const labelY = top + rowCount * rowPitch + 18;
      for (let group = start; group < end; group++) {
        const columns = Math.ceil(photos[group].length / rowCount);
        const ordered = photos[group].sort((a, b) => {
          const [ax, ay] = matrix.rects[a];
          const [bx, by] = matrix.rects[b];
          // Read the previous layout by row, then by column.
          return Math.round(ay / rowPitch) - Math.round(by / rowPitch) || ax - bx;
        });
        ordered.forEach((i, slot) => {
          const [, , width, height] = matrix.rects[i];
          rects[i] = [
            left + (slot % columns + .5) * columnPitch,
            top + (Math.floor(slot / columns) + .5) * rowPitch,
            width, height,
          ];
        });
        labels[group] = { text: labels[group].text, x: left, y: labelY };
        left += columns * columnPitch + columnGap;
      }
      widestRow = Math.max(widestRow, left - columnGap);
      top = labelY + matrix.labelSize + rowGap;
    }
    return {
      matrix: {
        ...matrix, labels, groups, rects,
        sideInset: margin, columnPitch, rowPitch,
        width: widestRow + margin,
        height: top - rowGap + margin,
      },
      assigned,
    };
  }

  function distributeCircles(bubbles, labels, assigned, removedCity) {
    const originalCities = bubbles.cities.filter(([name]) => name !== removedCity);
    const left = originalCities[0][1];
    const right = originalCities.at(-1)[1];
    const step = (right - left) / (originalCities.length - 1);
    const cities = originalCities.map(([name], i) => [name, left + step * i]);
    const indexByName = new Map(cities.map(([name], i) => [name, i]));
    const circleById = new Map(bubbles.circles.map(circle => [circle[0], circle]));
    const placements = new Map();
    const occupied = [];
    for (const [id, city, x, y, radius, family] of bubbles.circles) {
      const [name, anchor] = bubbles.cities[city];
      if (name === removedCity) continue;
      const target = indexByName.get(name);
      const circle = [id, target, x + (cities[target][1] - anchor), y, radius, family];
      occupied.push(circle);
      placements.set(id, circle);
    }

    labels.forEach(({ text }, group) => {
      const city = indexByName.get(text);
      const anchor = cities[city][1];
      const cluster = occupied.filter(([, index]) => index === city);
      const centerY = cluster.reduce((sum, [, , , y]) => sum + y, 0) / cluster.length;
      const minX = Math.ceil(anchor - step / 2);
      const maxX = Math.floor(anchor + step / 2);
      const nearby = occupied.filter(([, , x, , radius]) => x + radius >= minX && x - radius <= maxX);
      const candidates = [];
      for (let y = Math.ceil(bubbles.axisY + 40); y < bubbles.viewport[1]; y += 5) {
        for (let x = minX; x <= maxX; x += 5) {
          candidates.push({ x, y, distance: (x - anchor) ** 2 + (y - centerY) ** 2 });
        }
      }
      candidates.sort((a, b) => a.distance - b.distance);

      for (const id of assigned[group]) {
        const [, , , , radius, family] = circleById.get(id);
        const point = candidates.find(({ x, y }) =>
          x - radius >= minX && x + radius <= maxX && y + radius <= bubbles.viewport[1] &&
          nearby.every(([, , cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 >= (radius + r + 1) ** 2));
        if (!point) throw new Error("No space for reassigned firework " + id);
        const circle = [id, city, point.x, point.y, radius, family];
        nearby.push(circle);
        occupied.push(circle);
        placements.set(id, circle);
      }
    });
    return { ...bubbles, cities, circles: bubbles.circles.map(([id]) => placements.get(id)) };
  }

  window.createFireworkCityLayout = (matrix, bubbles) => {
    const removedCity = "Minneapolis";
    const removedGroup = matrix.labels.findIndex(({ text }) => text === removedCity);
    if (removedGroup === -1) return { matrix, bubbles };
    const layout = distributeMatrix(matrix, removedGroup);
    return {
      matrix: layout.matrix,
      bubbles: distributeCircles(bubbles, layout.matrix.labels, layout.assigned, removedCity),
    };
  };

  window.layoutCityFirework = (indices, frame, target, columnX, width, height, axisHeight) => {
    const padding = 8;
    const radius = Math.min(width * .195, height * .285, Math.max(0, height - axisHeight - 2 * padding) * .40);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    // Use the same samples on resize and when returning to this city.
    let seed = Math.imul(indices[0] + 1, 0x9e3779b1);
    function random() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    }
    const phase = 2 * Math.PI * random();
    let left = 0, right = 0, top = 0, bottom = 0;

    indices.forEach((index, rank) => {
      const angle = phase + rank * goldenAngle + (random() - .5) * .75;
      // The product biases the dots toward the center with a gradual drop in density.
      const spread = Math.sqrt(random() * (.08 + .92 * random()));
      const contour = .91 + .065 * Math.sin(3 * angle + phase)
        + .045 * Math.cos(5 * angle - phase) + .035 * Math.sin(8 * angle + phase);
      const distance = spread * contour * radius;
      const x = Math.cos(angle) * distance;
      const y = (Math.sin(angle) * .96 + .065 * spread) * distance;
      const dotRadius = frame[index * 6 + 2] / 2;
      target[index * 2] = x;
      target[index * 2 + 1] = y;
      left = Math.min(left, x - dotRadius);
      right = Math.max(right, x + dotRadius);
      top = Math.min(top, y - dotRadius);
      bottom = Math.max(bottom, y + dotRadius);
    });

    const centerX = Math.max(padding - left, Math.min(width - padding - right, columnX));
    const centerY = Math.max(axisHeight + padding - top, Math.min(height - padding - bottom, height * .59));
    for (const index of indices) {
      target[index * 2] += centerX;
      target[index * 2 + 1] += centerY;
    }
  };
})();
