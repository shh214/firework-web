(() => {
  "use strict";

  const mapWidth = 1486;
  const radiusScale = 1.4;
  const endPadding = 24;
  const circleGap = .35;
  const fallDuration = .23;
  const dimOpacity = .22;
  const previewEnlargement = 1.19;
  const clamp = value => Math.min(1, Math.max(0, value));
  const mix = (from, to, amount) => from + (to - from) * amount;
  const smooth = value => value * value * (3 - 2 * value);
  const rings = window.BOSTON_WATER;
  const [mainRiver, ...islands] = rings;
  // Bounds of the two end caps in the main ring's SVG coordinates.
  const eastCapStart = 127;
  const eastCapEnd = 143;
  const westCap = mainRiver.length - 1;
  const eastBank = Math.max(...mainRiver.map(([x]) => x));
  const southBank = Math.max(...mainRiver.map(([, y]) => y));
  const edges = rings.flatMap((ring, ringIndex) => ring.map(([x, y], i) => {
    const [endX, endY] = ring[(i + 1) % ring.length];
    const dx = endX - x, dy = endY - y;
    const endCap = ringIndex === 0 && (i === westCap || (i >= eastCapStart && i < eastCapEnd));
    return { x, y, dx, dy, lengthSquared: dx * dx + dy * dy, endCap };
  }));

  function distanceToBank(x, y) {
    let inside = false;
    let nearest = Infinity;
    let nearestCap = Infinity;
    for (const edge of edges) {
      const offsetX = x - edge.x, offsetY = y - edge.y;
      if ((edge.y > y) !== (edge.y + edge.dy > y) && offsetX < edge.dx * offsetY / edge.dy) {
        inside = !inside;
      }
      const along = clamp((offsetX * edge.dx + offsetY * edge.dy) / edge.lengthSquared);
      const gapX = offsetX - along * edge.dx, gapY = offsetY - along * edge.dy;
      const squared = gapX * gapX + gapY * gapY;
      nearest = Math.min(nearest, squared);
      if (edge.endCap) nearestCap = Math.min(nearestCap, squared);
    }
    return inside ? Math.min(Math.sqrt(nearest), Math.sqrt(nearestCap) - endPadding) : -Math.sqrt(nearest);
  }

  const path = points => "M" + points.map(point => point.join(",")).join("L");
  const closedPath = ring => path(ring) + "Z";
  const water = new Path2D(rings.map(closedPath).join(" "));
  const shoreline = [
    path(mainRiver.slice(0, eastCapStart + 1)),
    path(mainRiver.slice(eastCapEnd)),
    ...islands.map(closedPath),
  ].join(" ");

  function sampleWater(count) {
    // Use staggered rows to cover narrow bends as well as the main basin.
    function grid(spacing) {
      const points = [];
      let row = 0;
      for (let y = 8; y < southBank; y += spacing * Math.sqrt(3) / 2) {
        let column = 0;
        for (let x = 8 + (row % 2) * spacing / 2; x < eastBank; x += spacing) {
          const phase = row * 2.399 + column++ * 4.147;
          const px = x + Math.sin(phase) * spacing * .24;
          const py = y + Math.cos(phase * 1.17) * spacing * .24;
          const clearance = distanceToBank(px, py);
          if (clearance >= 4) points.push({ x: px, y: py, clearance });
        }
        row++;
      }
      return points;
    }
    let low = 12, high = 24;
    let points = grid(low);
    for (let i = 0; i < 9; i++) {
      const spacing = (low + high) / 2;
      const candidates = grid(spacing);
      if (candidates.length >= count) {
        low = spacing;
        points = candidates;
      } else {
        high = spacing;
      }
    }
    const targets = Array.from({ length: count }, (_, i) => points[Math.floor((i + .5) * points.length / count)]);
    return { targets, candidates: grid(6) };
  }

  function layoutRiver(records, palette) {
    const byHorizontalPosition = (a, b) => a.x - b.x || a.y - b.y;
    const sources = records.map(([id, , x, y, radius, family]) => ({ id, x, y, radius, family }))
      .sort(byHorizontalPosition);
    const { targets, candidates } = sampleWater(sources.length);
    targets.sort(byHorizontalPosition);
    const ranked = sources.map((source, i) => ({ source, i })).sort((a, b) => b.source.radius - a.source.radius);
    const available = candidates.map(target => ({ ...target, neighbors: [] }));
    const nodes = ranked.map(({ source, i }) => {
      const r = source.radius * radiusScale;
      const preferred = targets[i];
      // Give larger circles suitably wide parts of the river first.
      let best = -1;
      let bestScore = Infinity;
      available.forEach((candidate, index) => {
        if (candidate.clearance < r + 1) return;
        if (candidate.neighbors.some(neighbor => neighbor.radius + r + circleGap > neighbor.distance)) return;
        const score = (candidate.x - preferred.x) ** 2 + (candidate.y - preferred.y) ** 2;
        if (score < bestScore) {
          best = index;
          bestScore = score;
        }
      });
      if (best < 0) throw new Error("No river target can fit a Boston circle.");
      const [target] = available.splice(best, 1);
      for (const candidate of available) {
        const distance = Math.hypot(target.x - candidate.x, target.y - candidate.y);
        if (distance < 2 * r + circleGap) candidate.neighbors.push({ radius: r, distance });
      }
      return {
        source, r, color: palette[source.family], x: target.x, y: target.y,
      };
    });
    nodes.sort((a, b) => a.y + .16 * a.x - b.y - .16 * b.x);
    nodes.forEach((node, i) => { node.arrival = mix(fallDuration, .97, i / nodes.length); });
    return nodes;
  }

  window.createBostonRiver = (section, records, palette, sourceViewport, drawCutout) => {
    const viewport = section.querySelector(".boston-river-viewport");
    const mapFrame = viewport.querySelector(".boston-river-map");
    const map = mapFrame.querySelector("img");
    const banks = mapFrame.querySelector(".boston-river-banks");
    banks.querySelector("path").setAttribute("d", shoreline);
    const canvas = viewport.querySelector(".boston-river-circles");
    const context = canvas.getContext("2d");
    const previews = viewport.querySelector(".boston-river-previews");
    const sourceRadii = records.map(([, , , , radius]) => radius).sort((a, b) => a - b);
    const middle = Math.floor(sourceRadii.length / 2);
    const referenceRadius = mix(sourceRadii[middle], sourceRadii[Math.floor((sourceRadii.length - 1) / 2)], .5);
    const playhead = { flight: 0 };
    const timeline = gsap.timeline({ paused: true })
      .addLabel("revealMap", .035)
      .to(map, { opacity: 1, ease: "sine.inOut", duration: .195 }, "revealMap")
      .addLabel("highlightBanks", .34)
      .to(map, { opacity: .22, ease: "sine.inOut", duration: .20 }, "highlightBanks")
      .to(banks, { opacity: 1, ease: "sine.inOut", duration: .14 }, "highlightBanks")
      .addLabel("fall", .55)
      .to(playhead, { flight: 1, ease: "none", duration: .45 }, "fall");
    let nodes, view, pointer, hovered;
    let lastTime, lastWidth, lastHeight, lastRatio;

    function resizeCanvas(width, height, ratio) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }

    function paint(node, x, y, opacity) {
      context.globalAlpha = opacity;
      context.fillStyle = node.color;
      context.beginPath();
      context.arc(x, y, node.r, 0, 2 * Math.PI);
      context.fill();
    }

    function setVisible(visible) {
      section.hidden = !visible;
      lastTime = undefined;
      if (!visible) {
        pointer = view = hovered = undefined;
        clearPreviews();
      }
    }

    function draw(top, reduceMotion) {
      if (section.hidden) return;
      const height = viewport.clientHeight;
      const width = viewport.clientWidth;
      if (!height || !width) return;
      const scrollRange = section.offsetHeight - height;
      const progress = reduceMotion ? Number(top <= 1) : clamp(-top / Math.max(1, scrollRange));
      const ratio = Math.min(devicePixelRatio || 1, 2);
      if (progress === lastTime && width === lastWidth && height === lastHeight && ratio === lastRatio) return;
      if (width !== lastWidth || height !== lastHeight || ratio !== lastRatio) resizeCanvas(width, height, ratio);
      lastTime = progress;
      lastWidth = width;
      lastHeight = height;
      lastRatio = ratio;

      timeline.progress(progress);
      if (playhead.flight === 0) {
        view = hovered = undefined;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        clearPreviews();
        return;
      }
      nodes ??= layoutRiver(records, palette);

      const mapBounds = mapFrame.getBoundingClientRect();
      const viewportBounds = viewport.getBoundingClientRect();
      const mapX = mapBounds.left - viewportBounds.left;
      const mapY = mapBounds.top - viewportBounds.top;
      const scale = mapBounds.width / mapWidth;
      const originalScale = Math.min(width / sourceViewport[0], height / sourceViewport[1]);
      const originalLeft = (width - sourceViewport[0] * originalScale) / 2;
      const originalTop = (height - sourceViewport[1] * originalScale) / 2;
      const time = playhead.flight;
      view = { width, height, ratio, mapX, mapY, scale, originalScale, originalLeft, originalTop, time };
      updateHover();
      renderCircles();
    }

    function renderCircles() {
      const { width, height, ratio, mapX, mapY, scale, originalScale, originalLeft, originalTop, time } = view;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.translate(mapX, mapY);
      context.scale(scale, scale);
      context.save();
      context.clip(water, "evenodd");
      let landed = 0;
      while (landed < nodes.length && nodes[landed].arrival <= time) {
        const node = nodes[landed++];
        paint(node, node.x, node.y, node === hovered ? 1 : dimOpacity);
        if (node === hovered) {
          context.lineWidth = 1.25 / scale;
          context.strokeStyle = "#fff";
          context.stroke();
        }
      }
      context.restore();

      for (let i = landed; i < nodes.length; i++) {
        const node = nodes[i];
        const travel = 1 - (node.arrival - time) / fallDuration;
        if (travel <= 0) break;
        const sourceX = (originalLeft + node.source.x * originalScale - mapX) / scale;
        // The old field has moved one viewport up when the river is pinned.
        const sourceY = (originalTop + node.source.y * originalScale - height - mapY) / scale;
        const x = mix(sourceX, node.x, smooth(travel));
        const y = mix(sourceY, node.y, travel ** 1.25);
        paint(node, x, y, dimOpacity * clamp(travel * 5));
      }
    }

    function softenEdges(context) {
      const { width, height } = context.canvas;
      context.save();
      context.globalCompositeOperation = "destination-in";
      for (const [x, y] of [[width, 0], [0, height]]) {
        const mask = context.createLinearGradient(0, 0, x, y);
        mask.addColorStop(0, "transparent");
        mask.addColorStop(.16, "#000");
        mask.addColorStop(.84, "#000");
        mask.addColorStop(1, "transparent");
        context.fillStyle = mask;
        context.fillRect(0, 0, width, height);
      }
      context.restore();
    }

    function clearPreviews() {
      if (!previews.firstChild) return;
      gsap.killTweensOf(Array.from(previews.children));
      previews.replaceChildren();
    }

    function showPreview(node, x, y) {
      const preview = document.createElement("canvas");
      preview.className = "boston-firework-preview";
      preview.style.left = x + "px";
      preview.style.top = y + "px";
      const id = node.source.id;
      preview.dataset.photoId = id;
      const previewContext = preview.getContext("2d");
      // Compare the longest side so portrait and landscape photos use the same scale.
      function sizePreview() {
        const aspect = preview.width / Math.max(preview.width, preview.height);
        preview.style.setProperty("--preview-width-factor",
          String(aspect * previewEnlargement * node.source.radius / referenceRadius));
      }
      drawCutout(id, previewContext);
      sizePreview();
      softenEdges(previewContext);
      previews.append(preview);
      gsap.to(preview, {
        opacity: 0, delay: .55, duration: .85, ease: "sine.inOut",
        onComplete: () => preview.remove(),
      });

      if (location.protocol === "file:") {
        // The full-size cutouts are available in the project workspace.
        const image = new Image();
        image.src = "../../us-fireworks-scroll-three/cutouts/" + id + ".png";
        image.decode().then(() => {
          if (!preview.isConnected) return;
          const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
          preview.width = Math.max(1, Math.round(image.naturalWidth * scale));
          preview.height = Math.max(1, Math.round(image.naturalHeight * scale));
          previewContext.drawImage(image, 0, 0, preview.width, preview.height);
          sizePreview();
          softenEdges(previewContext);
        }, () => { /* The atlas cutout is already displayed. */ });
      }
    }

    function updateHover() {
      let node, x, y;
      if (pointer && view) {
        const bounds = viewport.getBoundingClientRect();
        x = pointer.x - bounds.left;
        y = pointer.y - bounds.top;
        const mapX = (x - view.mapX) / view.scale;
        const mapY = (y - view.mapY) / view.scale;
        node = nodes.findLast(node => node.arrival <= view.time &&
          (node.x - mapX) ** 2 + (node.y - mapY) ** 2 <= node.r ** 2);
      }
      if (hovered === node) return false;
      hovered = node;
      if (node) showPreview(node, x, y);
      return true;
    }

    viewport.addEventListener("pointermove", event => {
      if (event.pointerType === "touch") return;
      pointer = { x: event.clientX, y: event.clientY };
      if (updateHover()) renderCircles();
    });
    function leaveRiver() {
      pointer = undefined;
      if (updateHover()) renderCircles();
    }
    viewport.addEventListener("pointerleave", leaveRiver);
    viewport.addEventListener("pointercancel", leaveRiver);

    return { draw, setVisible };
  };
})();
