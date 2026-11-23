(() => {
  "use strict";

  const stage = document.getElementById("scene");
  const canvas = document.getElementById("cloud");
  const names = document.getElementById("cities");
  const matrix = window.FIREWORK_MATRIX;
  const sphere = window.FIREWORK_SPHERE;
  const cloud = window.FIREWORK_CLOUD;
  const compactness = 1.29, photoSize = 0.81;
  const clamp01 = n => Math.max(0, Math.min(1, n));
  function smooth(n) {
    const t = clamp01(n);
    return t * t * (3 - 2 * t);
  }
  function meanCenters(frames, groups, count) {
    const centers = Array.from({ length: count }, () => ({ x: 0, y: 0, n: 0 }));
    for (let i = 0; i < groups.length; i++) {
      const center = centers[groups[i]];
      center.x += frames[i * 6];
      center.y += frames[i * 6 + 1];
      center.n++;
    }
    for (const center of centers) {
      center.x /= center.n;
      center.y /= center.n;
    }
    return centers;
  }

  async function start() {
    if (cloud.photos.length !== sphere.ids.length || cloud.photos.length !== matrix.rects.length ||
        cloud.photos.some((photo, i) => photo.id !== sphere.ids[i] || photo.id !== matrix.photoIds[i])) {
      throw new Error("Photo IDs do not match the sphere and matrix layouts.");
    }
    const atlas = new Image();
    atlas.src = "../us-fireworks-cloud/" + cloud.atlas.file;
    await atlas.decode();
    const renderer = window.createFireworkRenderer(canvas, atlas, cloud);
    const count = cloud.photos.length;
    const source = new Float32Array(count * 6), target = new Float32Array(count * 6);
    const frame = new Float32Array(count * 6);
    const order = Uint16Array.from(cloud.photos, (_, i) => i);
    const tiles = cloud.photos.map((photo, i) => ({
      point: sphere.points[i],
      aspectX: photo.w / Math.max(photo.w, photo.h),
      aspectY: photo.h / Math.max(photo.w, photo.h),
    }));
    const labels = matrix.labels.map(({text}) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
      node.textContent = text;
      names.append(node);
      return node;
    });
    const meter = document.createElement("canvas").getContext("2d");
    const orientation = [1,0,0, 0,1,0, 0,0,1];
    const playhead = { value: 0 };
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let width, height, sourceCenters, targetCenters, requested = false;

    function projectSphere() {
      const view = sphere.view;
      const scale = Math.min(height / view.referenceHeight, width * 0.87 / view.diameter);
      const plane = scale * view.diameter / view.span;
      for (let i = 0; i < count; i++) {
        const k = i * 6, tile = tiles[i];
        // Same projection, framing, shading and tuning as the chosen sphere.
        window.projectFireworkTile(tile, orientation, view, 1 / compactness);
        source[k] = width / 2 + tile.gx * plane / tile.inverseP;
        source[k+1] = height / 2 + tile.gy * plane / tile.inverseP;
        source[k+2] = tile.side * scale * photoSize * tile.aspectX;
        source[k+3] = tile.side * scale * photoSize * tile.aspectY;
        source[k+4] = tile.z;
        source[k+5] = 1 - tile.shade;
      }
      order.sort((a, b) => source[a*6+4] - source[b*6+4] || a - b);
      sourceCenters = meanCenters(source, matrix.groups, labels.length);
    }

    function fitMatrix() {
      const scale = Math.min(width / matrix.width, height / matrix.height);
      const left = (width - matrix.width * scale) / 2;
      const top = (height - matrix.height * scale) / 2;
      for (let i = 0; i < count; i++) {
        const [cx, cy, w, h] = matrix.rects[i], k = i * 6;
        target[k] = left + cx * scale;
        target[k+1] = top + cy * scale;
        target[k+2] = w * scale;
        target[k+3] = h * scale;
        target[k+5] = 1;
      }
      targetCenters = meanCenters(target, matrix.groups, labels.length);
      // Keep the two approved rows on narrow screens. Allow a larger label
      // only when its full name still fits before the next city's left edge.
      const fontFamily = '"Helvetica Neue", Helvetica, Arial, sans-serif';
      meter.font = "100px " + fontFamily;
      let fontSize = Math.max(matrix.labelSize * scale, 9);
      for (let i = 0; i < labels.length - 1; i++) {
        const a = matrix.labels[i], b = matrix.labels[i+1];
        if (b.y !== a.y) continue;
        const available = (b.x - a.x) * scale - 3;
        fontSize = Math.min(fontSize, available * 100 / meter.measureText(a.text).width);
      }
      names.style.fontSize = fontSize + "px";
      meter.font = fontSize + "px " + fontFamily;
      labels.forEach((node, i) => {
        const {text, x, y} = matrix.labels[i];
        const ascent = meter.measureText(text).actualBoundingBoxAscent;
        node.setAttribute("x", String(left + x * scale));
        node.setAttribute("y", String(top + y * scale + ascent));
      });
    }

    function draw() {
      requested = false;
      const t = clamp01(playhead.value);
      if (t === 0 || t === 1) {
        renderer.draw(t === 0 ? source : target, order);
      } else {
        const travel = smooth(t / 0.88);
        for (let i = 0; i < count; i++) {
          const k = i * 6, city = matrix.groups[i];
          // Movement depends only on scroll position and the last orientation.
          // A city's center travels first, then its members settle into cells.
          const delay = 0.055 + 0.035 * (1 - source[k+4]);
          const place = reducedMotion.matches ? smooth(t) : smooth((t - delay) / (1 - delay));
          const lead = reducedMotion.matches ? 0 : travel - place;
          const from = sourceCenters[city], to = targetCenters[city];
          frame[k] = source[k] + (target[k] - source[k]) * place + (to.x - from.x) * lead;
          frame[k+1] = source[k+1] + (target[k+1] - source[k+1]) * place + (to.y - from.y) * lead;
          frame[k+2] = source[k+2] + (target[k+2] - source[k+2]) * place;
          frame[k+3] = source[k+3] + (target[k+3] - source[k+3]) * place;
          frame[k+4] = source[k+4] * (1 - travel);
          frame[k+5] = source[k+5] + (1 - source[k+5]) * place;
        }
        renderer.draw(frame, order);
      }
      names.style.opacity = String(smooth((t - 0.79) / 0.20));
      names.setAttribute("aria-hidden", String(t <= 0.79));
      canvas.classList.toggle("rotatable", t === 0);
    }
    function requestDraw() {
      if (!requested) {
        requested = true;
        requestAnimationFrame(draw);
      }
    }
    function resize() {
      width = stage.clientWidth;
      height = stage.clientHeight;
      if (!width || !height) return;
      renderer.resize(width, height, Math.min(devicePixelRatio || 1, 2));
      fitMatrix();
      projectSphere();
      requestDraw();
    }
    function rotate(yaw, pitch) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      for (let i = 0; i < 3; i++) {
        const x = orientation[i], y = orientation[i+3], z = orientation[i+6];
        const nz = cy * z - sy * x;
        orientation[i] = cy * x + sy * z;
        orientation[i+3] = cp * y + sp * nz;
        orientation[i+6] = cp * nz - sp * y;
      }
      projectSphere();
      requestDraw();
    }
    const atSphere = () => playhead.value === 0 && window.scrollY <= 0;
    let drag = null;
    canvas.addEventListener("pointerdown", e => {
      if (!atSphere() || !e.isPrimary || e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, decided: e.pointerType !== "touch" };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", e => {
      if (!drag || drag.id !== e.pointerId) return;
      if (!atSphere()) { drag = null; return; }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.decided) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 5) return;
        if (Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
        drag.decided = true;
      }
      const speed = 3.4 / Math.min(width, height);
      rotate(dx * speed, dy * speed);
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
      canvas.addEventListener(event, e => { if (drag?.id === e.pointerId) drag = null; });
    }
    window.addEventListener("keydown", e => {
      if (!atSphere() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        rotate(e.key === "ArrowLeft" ? -0.12 : 0.12, 0);
      }
    });

    resize();
    new ResizeObserver(resize).observe(stage);
    gsap.registerPlugin(ScrollTrigger);
    gsap.to(playhead, {
      value: 1,
      ease: "none",
      onUpdate: requestDraw,
      scrollTrigger: { start: 0, end: "max", scrub: reducedMotion.matches ? true : 0.16 },
    });
  }
  start().catch(error => {
    console.error(error);
    document.getElementById("failure").hidden = false;
  });
})();
