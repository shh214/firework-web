(() => {
  "use strict";

  const stage = document.getElementById("scene");
  const canvas = document.getElementById("cloud");
  const names = document.getElementById("cities");
  const sphere = window.FIREWORK_SPHERE;
  const cloud = window.FIREWORK_CLOUD;
  const compactness = 1.29, photoSize = 0.81;
  const cityPlacementEnd = .60;
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
    const originalCircles = window.FIREWORK_CIRCLES;
    const { matrix, bubbles } = window.createFireworkCityLayout(window.FIREWORK_MATRIX, originalCircles);
    if (cloud.photos.length !== sphere.ids.length || cloud.photos.length !== matrix.rects.length ||
        cloud.photos.some((photo, i) => photo.id !== sphere.ids[i] || photo.id !== matrix.photoIds[i])) {
      throw new Error("Photo IDs do not match the sphere and matrix layouts.");
    }
    const atlas = new Image();
    atlas.src = "fireworks-atlas.webp?v=058e6a85";
    await atlas.decode();
    const matrixInset = matrix.sideInset ?? 0;
    const sideMarginRatio = 2 * matrixInset / matrix.width;
    const photoIndex = new Map(matrix.photoIds.map((id, i) => [id, i]));
    const circles = new Array(matrix.photoIds.length);
    const circleOrder = bubbles.circles.map(([id, city, x, y, radius, family]) => {
      const i = photoIndex.get(id);
      if (i === undefined || circles[i] ||
          matrix.labels[matrix.groups[i]].text !== bubbles.cities[city][0]) {
        throw new Error("Circle and matrix records disagree for photo " + id);
      }
      circles[i] = { x, y, radius, family, color: bubbles.palette[family] };
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
    const matrixRunway = document.getElementById("matrix-runway");
    const colorRunway = document.getElementById("color-runway");
    const nextAct = document.getElementById("next-act");
    const nextActTitle = document.getElementById("next-act-title");
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const colorExplanation = window.createColorExplanation(
      document.getElementById("color-explanation"), circles, photoIndex, smooth, reducedMotion, requestDraw,
    );
    const explanationIndices = new Set(colorExplanation.slots.map(({ index }) => index));
    const explanationOrder = circleOrder.filter(index => explanationIndices.has(index));
    const remainingCircles = circleOrder.filter(index => !explanationIndices.has(index));
    // The river depicts Boston itself. Use only photos originally taken there,
    // starting from their positions in the third act.
    const bostonCity = originalCircles.cities.findIndex(([name]) => name === "Boston");
    const bostonPhotos = new Set(originalCircles.circles.filter(([, city]) => city === bostonCity).map(([id]) => id));
    const bostonRiver = window.createBostonRiver(
      document.getElementById("boston-river"),
      bubbles.circles.filter(([id]) => bostonPhotos.has(id)),
      bubbles.palette,
      projectCircleField,
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
        nextActTitle.textContent = "Act IV · " + name;
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
    const firstAnchor = bubbles.cities[0][1];
    const anchorStep = bubbles.cities[1][1] - firstAnchor;
    const fieldStart = firstAnchor - anchorStep / 2;

    function projectCircleField(viewWidth, viewHeight) {
      const margin = viewWidth * sideMarginRatio;
      const columnWidth = (viewWidth - 2 * margin) / bubbles.cities.length;
      const horizontalScale = columnWidth / anchorStep;
      const scale = Math.min(horizontalScale, viewHeight / bubbles.viewport[1]);
      const top = (viewHeight - bubbles.viewport[1] * scale) / 2;
      return {
        margin, columnWidth, scale,
        x: anchor => margin + (anchor - fieldStart) * horizontalScale,
        y: anchor => top + anchor * scale,
      };
    }

    function fitCircles() {
      const field = projectCircleField(width, height);
      const { margin, columnWidth, scale } = field;
      circles.forEach(({x, y, radius}, i) => {
        const k = i * 6;
        const r = radius * scale;
        endFrame[k] = Math.max(margin + r, Math.min(width - margin - r, field.x(x)));
        endFrame[k+1] = field.y(y);
        endFrame[k+2] = endFrame[k+3] = 2 * r;
        endFrame[k+5] = 1;
      });
      axis.replaceChildren();
      const ticks = bubbles.cities.map(([, x]) => field.x(x));
      const y = bubbles.axisY * scale;
      entries.style.top = y + "px";
      axisElement("line", {x1:ticks[0], x2:ticks.at(-1), y1:y, y2:y, stroke:"#858580", "stroke-width":Math.max(.6,.75*scale)});
      bubbles.cities.forEach(([name], i) => {
        cityButtons[i].style.left = (margin + i * columnWidth) + "px";
        cityButtons[i].style.width = columnWidth + "px";
        const x = ticks[i], small = columnWidth < 80, labelY = y + 13*scale;
        axisElement("line", {x1:x, x2:x, y1:y, y2:y+7*scale, stroke:"#a6a59f", "stroke-width":Math.max(.6,.75*scale)});
        const label = axisElement("text", {x, y:labelY, fill:"#dededa", "font-size":Math.max(10,15.7*scale),
          "text-anchor":small ? "start":"middle", "dominant-baseline":"hanging"});
        if (small) label.setAttribute("transform", "rotate(70 " + x + " " + labelY + ")");
        label.textContent = name;
      });
    }
    const meter = document.createElement("canvas").getContext("2d");
    const orientation = [1,0,0, 0,1,0, 0,0,1];
    let width, height;
    let sourceCenters, targetCenters, requested = false;

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
      const margin = width * sideMarginRatio;
      const contentWidth = matrix.width - 2 * matrixInset;
      const scale = Math.min((width - 2 * margin) / contentWidth, height / matrix.height);
      const left = margin - matrixInset * scale;
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

    function drawColorCircles(placement, reveal, pointOpacity) {
      if (reveal === 1 && pointOpacity === 1) {
        renderer.draw(endFrame, circleOrder, 1);
        return;
      }
      frame.set(endFrame);
      if (reveal > 0) {
        for (const index of remainingCircles) frame[index * 6 + 5] = reveal * pointOpacity;
      }

      // In reduced motion the seven circles fade between stationary positions.
      const travel = reducedMotion.matches ? Number(placement >= .5) : smooth(placement);
      const opacity = reducedMotion.matches ? pointOpacity * smooth(Math.abs(2 * placement - 1)) : pointOpacity;
      for (const { index, x, y, diameter } of colorExplanation.slots) {
        const k = index * 6;
        frame[k] = x + (endFrame[k] - x) * travel;
        frame[k+1] = y + (endFrame[k+1] - y) * travel;
        frame[k+2] = frame[k+3] = diameter + (endFrame[k+2] - diameter) * travel;
        frame[k+5] = opacity;
      }
      renderer.draw(frame, reveal === 0 ? explanationOrder : circleOrder, 1);
    }

    function draw() {
      requested = false;
      const nextTop = nextAct.hidden ? Infinity : nextAct.getBoundingClientRect().top;
      bostonRiver.draw(nextTop);
      const { matrixTravel: t, matrixOpacity, pointOpacity, cityArrival } = colorExplanation.readFrame();
      const placement = clamp01(cityArrival / cityPlacementEnd);
      const reveal = smooth((cityArrival - cityPlacementEnd) / (1 - cityPlacementEnd));
      const namesOpacity = smooth((t - .79) / .20) * matrixOpacity;
      names.style.opacity = String(namesOpacity);
      names.setAttribute("aria-hidden", String(namesOpacity === 0));
      axis.style.opacity = String(reveal);
      entries.hidden = !colorExplanation.scroll.atCities || cityArrival < 1 || nextTop <= 1;
      if (nextTop <= 0) return;
      canvas.classList.toggle("rotatable", colorExplanation.atSphere);
      if (t === 1) {
        if (matrixOpacity > 0) {
          if (matrixOpacity === 1) renderer.draw(target, order);
          else {
            frame.set(target);
            for (let i = 0; i < count; i++) frame[i * 6 + 5] = matrixOpacity;
            renderer.draw(frame, order);
          }
        } else if (pointOpacity > 0) {
          drawColorCircles(placement, reveal, pointOpacity);
        } else {
          renderer.draw(target, []);
        }
        return;
      }
      if (t === 0) {
        renderer.draw(source, order);
      } else {
        const travel = smooth(t / 0.88);
        for (let i = 0; i < count; i++) {
          const k = i * 6, city = matrix.groups[i];
          // Animate from the last sphere orientation into the city cells.
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
          frame[k+5] = source[k+5] + (matrixOpacity - source[k+5]) * place;
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
      const matrixLength = matrixRunway.offsetHeight;
      renderer.resize(width, height, Math.min(devicePixelRatio || 1, 2));
      fitMatrix();
      fitCircles();
      colorExplanation.resize(width, height);
      colorExplanation.scroll.resize(matrixLength, matrixLength + colorRunway.offsetHeight);
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
    const atSphere = () => colorExplanation.atSphere && window.scrollY <= 0;
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
    reducedMotion.addEventListener("change", requestDraw);
    window.addEventListener("scroll", updateNextAct, { passive: true });
    window.addEventListener("scrollend", updateNextAct);
  }
  start().catch(error => {
    console.error(error);
    document.getElementById("failure").hidden = false;
  });
})();
