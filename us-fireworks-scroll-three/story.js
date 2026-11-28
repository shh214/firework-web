(() => {
  "use strict";

  const stage = document.getElementById("scene");
  const canvas = document.getElementById("cloud");
  const names = document.getElementById("cities");
  const sphere = window.FIREWORK_SPHERE;
  const cloud = window.FIREWORK_CLOUD;
  const compactness = 1.29, photoSize = 0.81;
  const cityPlacementEnd = .60;
  const readingTime = 500;
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
      circles[i] = { city, x, y, radius, family, color: bubbles.palette[family] };
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
    const fireworkPositions = new Float32Array(count * 2);
    const circlesByCity = bubbles.cities.map(() => []);
    for (const index of circleOrder) circlesByCity[circles[index].city].push(index);
    const axis = document.getElementById("axis");
    const axisTicks = axis.querySelector(".city-axis-ticks");
    const entries = document.getElementById("city-entries");
    const matrixRunway = document.getElementById("matrix-runway");
    const colorRunway = document.getElementById("color-runway");
    const cityHold = document.getElementById("third-act-hold");
    const nextAct = document.getElementById("next-act");
    const nextActTitle = document.getElementById("next-act-title");
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const colorExplanation = window.createColorExplanation(
      document.getElementById("color-explanation"), circles, photoIndex, smooth, reducedMotion, requestDraw,
      { handlesScroll: handlesCityScroll, canAdvance: canAdvanceCity, advance: advanceCity, syncScroll: syncCityScroll },
      readingTime,
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
    const cityMotion = { focus: 0, firework: 0, blend: 1 };
    const outgoingCityFrame = new Float32Array(frame.length);
    let selectedCity = -1, cityStep = "columns";
    let cityStart, cityOffset, axisHeight;
    let outgoingWidth, outgoingHeight;
    let pageTween, cityReadyAt = Infinity;
    const cityColumns = bubbles.cities.map((_, index) => {
      const column = document.createElement("div");
      column.className = "city-entry";
      column.addEventListener("click", () => selectCity(index));
      entries.append(column);
      return column;
    });
    const axisButtons = bubbles.cities.map(([name], index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "city-axis-city";
      const label = document.createElement("span");
      label.textContent = name;
      button.append(label);
      button.addEventListener("click", () => selectCity(index));
      button.addEventListener("pointerenter", event => {
        if (event.pointerType !== "touch") cityColumns[index].classList.add("is-previewed");
      });
      button.addEventListener("pointerleave", () => cityColumns[index].classList.remove("is-previewed"));
      axis.append(button);
      return button;
    });
    function axisElement(tag, attrs) {
      const el = document.createElementNS(names.namespaceURI, tag);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
      axisTicks.append(el);
      return el;
    }
    const firstAnchor = bubbles.cities[0][1];
    const anchorStep = bubbles.cities[1][1] - firstAnchor;
    const fieldStart = firstAnchor - anchorStep / 2;

    function showAxisSelection() {
      axis.querySelector("[aria-current]")?.removeAttribute("aria-current");
      axis.toggleAttribute("data-selected", selectedCity >= 0);
      axisButtons[selectedCity]?.setAttribute("aria-current", "true");
    }

    function fitFirework() {
      const { x } = projectCircleField(width, height);
      window.layoutCityFirework(circlesByCity[selectedCity], endFrame, fireworkPositions,
        x(bubbles.cities[selectedCity][1]), width, height, axisHeight);
    }

    function selectCity(index) {
      if (axis.inert || index === selectedCity && cityStep !== "clearing") return;
      const switching = selectedCity >= 0 && !reducedMotion.matches;
      const returning = !nextAct.hidden;
      if (selectedCity < 0) cityOffset = window.scrollY - cityStart;
      if (switching) {
        // Start from the visible dots even if another switch or morph is still playing.
        composeCityFrame();
        outgoingCityFrame.set(frame);
        outgoingWidth = width;
        outgoingHeight = height;
      }
      pageTween?.kill();
      pageTween = null;
      gsap.killTweensOf(cityMotion);
      selectedCity = index;
      cityStep = "columns";
      cityMotion.firework = 0;
      cityMotion.blend = switching ? 0 : 1;
      cityReadyAt = Infinity;
      fitFirework();
      showAxisSelection();
      if (!axis.contains(document.activeElement)) axis.focus({ preventScroll: true });
      if (switching) {
        cityMotion.focus = 1;
        gsap.to(cityMotion, { blend: 1, duration: returning ? .90 : .52, ease: "sine.inOut", onUpdate: requestDraw });
      } else if (cityMotion.focus < 1) {
        const duration = reducedMotion.matches ? 0 : .34;
        gsap.to(cityMotion, { focus: 1, duration, ease: "power1.out", onUpdate: requestDraw });
      }
      if (returning) scrollBetweenScenes(cityScrollTop, hideNextAct);
      requestDraw();
    }

    const cityScrollTop = () => cityStart + Math.max(1, Math.min(cityHold.offsetHeight, cityOffset));
    const scrollPage = top => window.scrollTo({ top, behavior: "instant" });

    function playFirework(formed) {
      cityStep = formed ? "firework" : "columns";
      cityReadyAt = Infinity;
      const duration = reducedMotion.matches ? 0 : formed ? 1.1 : .75;
      gsap.killTweensOf(cityMotion, "firework");
      gsap.to(cityMotion, { firework: Number(formed), duration, ease: "power2.inOut", onUpdate: requestDraw });
      requestDraw();
    }

    function clearCity() {
      cityStep = "clearing";
      gsap.killTweensOf(cityMotion);
      gsap.to(cityMotion, {
        focus: 0, firework: 0, duration: reducedMotion.matches ? 0 : .30, ease: "power1.out", onUpdate: requestDraw,
        onComplete() {
          const button = axisButtons[selectedCity];
          entries.hidden = false;
          if (document.activeElement === axis) button.focus({ preventScroll: true });
          selectedCity = -1;
          cityStep = "columns";
          showAxisSelection();
          requestDraw();
        },
      });
    }

    function showNextActCity() {
      const name = bubbles.cities[selectedCity][0];
      nextAct.dataset.city = name;
      nextActTitle.textContent = "Act IV · " + name;
      bostonRiver.setVisible(name === "Boston");
    }

    function hideNextAct() {
      nextAct.hidden = true;
      bostonRiver.setVisible(false);
    }

    function moveBetweenActs(enter) {
      cityReadyAt = Infinity;
      if (enter) {
        cityStep = "later";
        showNextActCity();
        nextAct.hidden = false;
      }
      scrollBetweenScenes(enter ? () => nextAct.offsetTop : cityScrollTop, () => {
        if (enter) {
          nextActTitle.focus({ preventScroll: true });
        } else {
          cityStep = "firework";
          hideNextAct();
          axis.focus({ preventScroll: true });
        }
      });
    }

    function scrollBetweenScenes(destination, onArrival) {
      function finish() {
        pageTween = null;
        onArrival();
        requestDraw();
      }
      const from = window.scrollY;
      if (reducedMotion.matches || Math.abs(from - destination()) <= 1) {
        scrollPage(destination());
        finish();
        return;
      }
      const travel = { value: 0 };
      pageTween = gsap.to(travel, {
        value: 1, duration: .75, ease: "power2.inOut",
        onUpdate: () => scrollPage(from + (destination() - from) * travel.value),
        onComplete: finish,
      });
    }

    function handlesCityScroll(direction) {
      if (selectedCity < 0) return false;
      return !!pageTween || cityStep !== "later"
        || (direction < 0 ? window.scrollY <= nextAct.offsetTop + 1 : !canAdvanceCity(1));
    }

    function canAdvanceCity(direction) {
      return !pageTween && cityMotion.blend === 1 && cityStep !== "clearing"
        && (direction < 0 || performance.now() >= cityReadyAt);
    }

    function advanceCity(direction) {
      if (!canAdvanceCity(direction)) return;
      if (cityStep === "later") {
        if (direction < 0) moveBetweenActs(false);
      } else if (cityStep === "columns") {
        if (direction > 0) playFirework(true);
        else if (cityMotion.firework === 0) clearCity();
      } else if (direction < 0) playFirework(false);
      else moveBetweenActs(true);
    }

    function syncCityScroll() {
      if (selectedCity < 0) return false;
      requestDraw();
      if (pageTween) return true;
      const top = cityStep === "later" ? nextAct.offsetTop : cityScrollTop();
      const delta = window.scrollY - top;
      if (Math.abs(delta) > 1 && (cityStep !== "later" || delta < 0 || !canAdvanceCity(1))) {
        // Also handle native scroll that arrives without a cancelable gesture.
        scrollPage(top);
        advanceCity(Math.sign(delta));
      }
      return true;
    }

    function startCityReadingWhenShown() {
      if (selectedCity < 0 || cityReadyAt !== Infinity || pageTween || cityMotion.blend < 1) return;
      if (cityStep === "later" || cityStep === "columns" && cityMotion.focus === 1 && cityMotion.firework === 0
          || cityStep === "firework" && cityMotion.firework === 1) {
        cityReadyAt = performance.now() + readingTime;
      }
    }

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
      axisTicks.replaceChildren();
      const ticks = bubbles.cities.map(([, x]) => field.x(x));
      const y = bubbles.axisY * scale;
      const labelY = y + 13 * scale;
      const fontSize = Math.max(10, 15.7 * scale);
      const small = columnWidth < 80;
      axisHeight = Math.ceil(labelY + (small ? 86 : fontSize + 12));
      axis.style.height = axisHeight + "px";
      axis.style.fontSize = fontSize + "px";
      axis.style.setProperty("--city-axis-top", y + "px");
      axis.style.setProperty("--city-axis-label-offset", (labelY - y) + "px");
      axis.toggleAttribute("data-narrow", small);
      stage.style.setProperty("--city-axis-top", y + "px");
      axisElement("line", {x1:ticks[0], x2:ticks.at(-1), y1:y, y2:y, stroke:"#858580", "stroke-width":Math.max(.6,.75*scale)});
      ticks.forEach((x, i) => {
        for (const control of [axisButtons[i], cityColumns[i]]) {
          control.style.left = (margin + i * columnWidth) + "px";
          control.style.width = columnWidth + "px";
        }
        axisElement("line", {x1:x, x2:x, y1:y, y2:y+7*scale, stroke:"#a6a59f", "stroke-width":Math.max(.6,.75*scale)});
      });
      if (selectedCity >= 0) fitFirework();
    }
    const meter = document.createElement("canvas").getContext("2d");
    const orientation = [1,0,0, 0,1,0, 0,0,1];
    let width, height;
    let sourceCenters, targetCenters, requested = false;

    const explorer = window.createPhotoExplorer(canvas, cloud.photos, reducedMotion, requestDraw);
    let railWidth;
    function projectSphere() {
      const view = sphere.view;
      const scale = Math.min(height / view.referenceHeight, (width - railWidth) * 0.87 / view.diameter);
      const plane = scale * view.diameter / view.span;
      for (let i = 0; i < count; i++) {
        const k = i * 6, tile = tiles[i];
        // Same projection, framing, shading and tuning as the chosen sphere.
        window.projectFireworkTile(tile, orientation, view, 1 / compactness);
        source[k] = (width + railWidth) / 2 + tile.gx * plane / tile.inverseP;
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
      const viewWidth = width - railWidth;
      const margin = viewWidth * sideMarginRatio;
      const contentWidth = matrix.width - 2 * matrixInset;
      const scale = Math.min((viewWidth - 2 * margin) / contentWidth, height / matrix.height);
      explorer.setGridPitch(matrix.columnPitch * scale, matrix.rowPitch * scale);
      const left = railWidth + (viewWidth - matrix.width * scale) / 2;
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

    function composeCityFrame() {
      const { focus, firework, blend } = cityMotion;
      frame.set(endFrame);
      const backgroundOpacity = Math.max(0, 1 - .85 * focus - .15 * firework);
      for (const index of circleOrder) {
        if (circles[index].city !== selectedCity) frame[index * 6 + 5] = backgroundOpacity;
      }
      for (const index of circlesByCity[selectedCity]) {
        const k = index * 6;
        frame[k] += (fireworkPositions[index * 2] - frame[k]) * firework;
        frame[k + 1] += (fireworkPositions[index * 2 + 1] - frame[k + 1]) * firework;
      }
      if (blend < 1) {
        const outgoing = 1 - blend;
        const scaleX = width / outgoingWidth, scaleY = height / outgoingHeight;
        for (const index of circleOrder) {
          const k = index * 6;
          frame[k] += (outgoingCityFrame[k] * scaleX - frame[k]) * outgoing;
          frame[k + 1] += (outgoingCityFrame[k + 1] * scaleY - frame[k + 1]) * outgoing;
          frame[k + 5] += (outgoingCityFrame[k + 5] - frame[k + 5]) * outgoing;
        }
      }
    }

    function draw() {
      requested = false;
      const nextTop = nextAct.hidden ? Infinity : nextAct.getBoundingClientRect().top;
      bostonRiver.draw(nextTop);
      startCityReadingWhenShown();
      const { matrixTravel: t, matrixOpacity, pointOpacity, cityArrival } = colorExplanation.readFrame();
      const placement = clamp01(cityArrival / cityPlacementEnd);
      const reveal = smooth((cityArrival - cityPlacementEnd) / (1 - cityPlacementEnd));
      explorer.setLayout(colorExplanation.atSphere ? source : colorExplanation.atMatrix ? target : null,
        colorExplanation.inPhotoActs, colorExplanation.atMatrix);
      const namesOpacity = (1 - explorer.progress) * smooth((t - .79) / .20) * matrixOpacity;
      names.style.opacity = String(namesOpacity);
      names.setAttribute("aria-hidden", String(namesOpacity === 0));
      axis.style.opacity = String(reveal);
      axis.inert = !colorExplanation.scroll.atCities || cityArrival < 1;
      entries.hidden = selectedCity >= 0 || axis.inert;
      if (nextTop <= 0) return;
      canvas.classList.toggle("rotatable", colorExplanation.atSphere);
      if (explorer.active) {
        explorer.draw(frame, order, renderer);
      } else if (selectedCity >= 0) {
        composeCityFrame();
        renderer.draw(frame, circleOrder, 1);
      } else if (t === 1) {
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
      } else if (t === 0) {
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
    function resize() {
      width = stage.clientWidth;
      height = stage.clientHeight;
      if (!width || !height) return;
      railWidth = explorer.resize(width, height);
      const matrixLength = matrixRunway.offsetHeight;
      renderer.resize(width, height, Math.min(devicePixelRatio || 1, 2));
      fitMatrix();
      fitCircles();
      colorExplanation.resize(width, height);
      cityStart = matrixLength + colorRunway.offsetHeight;
      if (selectedCity >= 0 && !pageTween) {
        if (cityStep !== "later") scrollPage(cityScrollTop());
        else if (window.scrollY < nextAct.offsetTop) scrollPage(nextAct.offsetTop);
      }
      colorExplanation.scroll.resize(matrixLength, cityStart);
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
    const atSphere = () => !explorer.active && colorExplanation.atSphere && window.scrollY <= 0;
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
  }
  start().catch(error => {
    console.error(error);
    document.getElementById("failure").hidden = false;
  });
})();
