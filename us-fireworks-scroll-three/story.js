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
    atlas.src = "fireworks-atlas.webp?v=058e6a85";
    await atlas.decode();
    const bubbles = window.FIREWORK_CIRCLES;
    const photoIndex = new Map(matrix.photoIds.map((id, i) => [id, i]));
    const circles = new Array(matrix.photoIds.length);
    const circleOrder = bubbles.circles.map(([id, city, x, y, radius, family]) => {
      const i = photoIndex.get(id);
      if (i === undefined || circles[i] ||
          matrix.labels[matrix.groups[i]].text !== bubbles.cities[city][0]) {
        throw new Error("Circle and matrix records disagree for photo " + id);
      }
      circles[i] = { x, y, radius, color: bubbles.palette[family] };
      return i;
    });
    if (circleOrder.length !== circles.length) throw new Error("Incomplete circle layout");
    const renderer = window.createFireworkRenderer(canvas, atlas, cloud, circles, bubbles.alpha);
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
    const endFrame = new Float32Array(count * 6);
    const axis = document.getElementById("axis");
    const entries = document.getElementById("city-entries");
    const storyRunway = document.getElementById("story-runway");
    const nextAct = document.getElementById("next-act");
    const nextActTitle = document.getElementById("next-act-title");
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const bostonCity = bubbles.cities.findIndex(([name]) => name === "Boston");
    const bostonRiver = window.createBostonRiver(
      document.getElementById("boston-river"),
      bubbles.circles.filter(([, city]) => city === bostonCity),
      bubbles.palette,
      bubbles.viewport,
      (id, context) => renderer.drawCutout(context, photoIndex.get(id)),
    );
    let enteredNextAct = false;
    const cityButtons = bubbles.cities.map(([name]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "city-entry";
      button.setAttribute("aria-label", name);
      button.addEventListener("click", () => {
        nextAct.dataset.city = name;
        bostonRiver.setVisible(name === "Boston");
        nextAct.hidden = false;
        nextActTitle.textContent = "第四幕 · " + name;
        nextActTitle.focus({ preventScroll: true });
        window.scrollTo({ top: nextAct.offsetTop, behavior: reducedMotion.matches ? "instant" : "smooth" });
        requestDraw();
      });
      entries.append(button);
      return button;
    });
    function axisElement(tag, attrs) {
      const el = document.createElementNS(names.namespaceURI, tag);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
      axis.append(el);
      return el;
    }
    function fitCircles() {
      const [vw, vh] = bubbles.viewport;
      const scale = Math.min(width / vw, height / vh);
      const left = (width - vw * scale) / 2;
      const top = (height - vh * scale) / 2;
      circles.forEach(({x, y, radius}, i) => {
        const k = i * 6;
        endFrame[k] = left + x * scale;
        endFrame[k+1] = top + y * scale;
        endFrame[k+2] = endFrame[k+3] = 2 * radius * scale;
        endFrame[k+5] = 1;
      });
      axis.replaceChildren();
      const ticks = bubbles.cities.map(([, x]) => left + x * scale);
      const y = bubbles.axisY * scale;
      entries.style.top = y + "px";
      let columnLeft = 0;
      axisElement("line", {x1:ticks[0], x2:ticks.at(-1), y1:y, y2:y, stroke:"#858580", "stroke-width":Math.max(.6,.75*scale)});
      bubbles.cities.forEach(([name], i) => {
        const columnRight = i + 1 < ticks.length ? (ticks[i] + ticks[i+1]) / 2 : width;
        cityButtons[i].style.left = columnLeft + "px";
        cityButtons[i].style.width = (columnRight - columnLeft) + "px";
        columnLeft = columnRight;
        const x = ticks[i], small = scale < .55, labelY = y + 13*scale;
        axisElement("line", {x1:x, x2:x, y1:y, y2:y+7*scale, stroke:"#a6a59f", "stroke-width":Math.max(.6,.75*scale)});
        const label = axisElement("text", {x, y:labelY, fill:"#dededa", "font-size":Math.max(10,15.7*scale),
          "text-anchor":small ? "start":"middle", "dominant-baseline":"hanging"});
        if (small) label.setAttribute("transform", "rotate(70 " + x + " " + labelY + ")");
        label.textContent = name;
      });
    }
    const meter = document.createElement("canvas").getContext("2d");
    const orientation = [1,0,0, 0,1,0, 0,0,1];
    const playhead = { value: 0 };
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
      const nextTop = nextAct.hidden ? Infinity : nextAct.getBoundingClientRect().top;
      bostonRiver.draw(nextTop, reducedMotion.matches);
      const runwayLength = storyRunway.offsetHeight;
      const runway = Math.max(1, (runwayLength - height*.24) / 2);
      const distance = playhead.value * runwayLength;
      const t = clamp01(distance / runway);
      const u = clamp01((distance - runway - height*.24) / runway);
      names.style.opacity = String(smooth((t - .79) / .20) * (1 - smooth(u / .27)));
      names.setAttribute("aria-hidden", String(t <= .79 || u >= .27));
      axis.style.opacity = String(smooth((u-.48)/.44));
      entries.hidden = u < .98 || nextTop <= 1;
      if (nextTop <= 0) return;
      canvas.classList.toggle("rotatable", t === 0);
      if (u > 0) {
        const travel = smooth(u);
        for (let i = 0; i < count; i++) {
          const k = i * 6;
          for (let j = 0; j < 4; j++) frame[k+j] = target[k+j] + (endFrame[k+j] - target[k+j]) * travel;
          frame[k+5] = 1;
        }
        renderer.draw(frame, circleOrder, smooth((u-.08)/.86));
        return;
      }
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
    }
    function requestDraw() {
      if (!requested) {
        requested = true;
        requestAnimationFrame(draw);
      }
    }
    function updateNextAct(event) {
      if (nextAct.hidden) return;
      if (nextAct.getBoundingClientRect().top < height - 1) {
        enteredNextAct = true;
      } else if (enteredNextAct || event.type === "scrollend") {
        nextAct.hidden = true;
        bostonRiver.setVisible(false);
        enteredNextAct = false;
      }
      requestDraw();
    }
    function resize() {
      width = stage.clientWidth;
      height = stage.clientHeight;
      if (!width || !height) return;
      renderer.resize(width, height, Math.min(devicePixelRatio || 1, 2));
      fitMatrix();
      fitCircles();
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
    window.addEventListener("scroll", updateNextAct, { passive: true });
    window.addEventListener("scrollend", updateNextAct);
    gsap.registerPlugin(ScrollTrigger);
    gsap.to(playhead, {
      value: 1,
      ease: "none",
      onUpdate: requestDraw,
      scrollTrigger: { start: 0, end: () => storyRunway.offsetHeight, scrub: reducedMotion.matches ? true : 0.16 },
    });
  }
  start().catch(error => {
    console.error(error);
    document.getElementById("failure").hidden = false;
  });
})();
