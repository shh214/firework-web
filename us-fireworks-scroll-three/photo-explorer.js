(() => {
  "use strict";

  window.createPhotoExplorer = function (canvas, photos, reducedMotion, requestDraw) {
    const list = document.getElementById("photo-list");
    const field = document.getElementById("photo-field");
    const captions = window.FIREWORK_PHOTO_CAPTIONS;
    const url = i => "assets/original-photos/" + photos[i].id + ".jpg";
    const nodes = new Map();
    const camera = { x: .5, y: .5, logZoom: 0, detail: 0 };
    let width, height, rail, layout, selected = -1, returning = false;
    let grid, columnPitch, rowPitch, pendingIndex = -1;
    let pan, swallowWheelUntil = 0;
    let panX = 0, panY = 0;

    const buttons = document.createDocumentFragment();
    photos.forEach(({ id }, i) => {
      const [city, year] = captions[id];
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.index = i;
      button.setAttribute("aria-label", city + ", " + year + ", photograph " + id);
      const image = new Image();
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.src = url(i);
      button.append(image);
      buttons.append(button);
    });
    list.append(buttons);

    function tween(properties, seconds, onComplete) {
      // Fold dragging into the next flight's starting position.
      camera.x += panX;
      camera.y += panY;
      panX = panY = 0;
      gsap.to(camera, { ...properties, duration: reducedMotion.matches ? 0 : seconds,
        ease: "power2.inOut", overwrite: true, onUpdate: requestDraw, onComplete });
    }

    function destination(i) {
      const k = i * 6;
      const side = Math.min(190, (width - rail) * .31, height * .29);
      const zoom = grid ? (side + 14) / columnPitch : side / Math.max(layout[k+2], layout[k+3]);
      return { x: (layout[k] - rail) / (width - rail), y: layout[k+1] / height,
        logZoom: Math.log(Math.max(1.2, zoom)), detail: 1 };
    }

    function reset() {
      gsap.killTweensOf(camera);
      Object.assign(camera, { x: .5, y: .5, logZoom: 0, detail: 0 });
      list.children[selected]?.removeAttribute("aria-current");
      selected = -1;
      panX = panY = 0;
      returning = false;
      pan = null;
      field.hidden = true;
      field.replaceChildren();
      nodes.clear();
      canvas.classList.remove("exploring");
      requestDraw();
    }

    function zoomOut() {
      if (selected < 0 || returning) return;
      pan = null;
      returning = true;
      tween({ x: .5, y: .5, logZoom: 0, detail: 0 }, .78, reset);
    }

    function select(index) {
      const button = list.children[index];
      if (selected === index && !returning) { zoomOut(); return; }
      list.children[selected]?.removeAttribute("aria-current");
      selected = index;
      button.setAttribute("aria-current", "true");
      returning = false;
      pan = null;
      field.hidden = false;
      canvas.classList.add("exploring");
      tween(destination(index), .85);
      requestDraw();
    }
    // A selection made during travel opens as soon as the new layout settles.
    list.addEventListener("click", e => {
      const button = e.target.closest("button");
      if (!button) return;
      const index = Number(button.dataset.index);
      if (layout) select(index);
      else pendingIndex = index;
    });
    // The list owns these gestures even when it has reached either end.
    for (const type of ["wheel", "touchstart", "touchmove", "keydown"]) {
      list.addEventListener(type, e => {
        if (e.key === "Escape") zoomOut();
        e.stopPropagation();
      });
    }
    canvas.addEventListener("wheel", e => {
      if (e.ctrlKey || e.metaKey || (!e.deltaY && !e.deltaX)) return;
      const now = performance.now();
      if (selected < 0 && now >= swallowWheelUntil) return;
      e.preventDefault();
      e.stopPropagation();
      if (returning || selected < 0 || e.deltaY > 0) {
        swallowWheelUntil = now + 220;
        zoomOut();
      }
    }, { passive: false });
    window.addEventListener("keydown", e => {
      if (selected >= 0 && e.key === "Escape") zoomOut();
    });
    for (const type of ["touchstart", "touchmove"]) {
      canvas.addEventListener(type, e => { if (selected >= 0) e.stopPropagation(); }, { passive: true });
    }
    canvas.addEventListener("pointerdown", e => {
      if (selected < 0 || returning || e.button !== 0 || !e.isPrimary) return;
      pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", e => {
      if (!pan || pan.id !== e.pointerId) return;
      const zoom = Math.exp(camera.logZoom);
      panX -= (e.clientX - pan.x) / ((width - rail) * zoom);
      panY -= (e.clientY - pan.y) / (height * zoom);
      pan.x = e.clientX;
      pan.y = e.clientY;
      requestDraw();
    });
    for (const type of ["lostpointercapture", "pointercancel", "pointerup"]) {
      canvas.addEventListener(type, e => { if (pan?.id === e.pointerId) pan = null; });
    }

    function makeFigure(i) {
      const figure = document.createElement("figure");
      const image = new Image();
      image.src = url(i);
      image.alt = "Fireworks";
      const caption = document.createElement("figcaption");
      const [city, year] = captions[photos[i].id];
      caption.append(city, document.createElement("br"), String(year));
      figure.append(image, caption);
      field.append(figure);
      nodes.set(i, figure);
      return figure;
    }

    function draw(frame, order, renderer) {
      const zoom = Math.exp(camera.logZoom);
      const viewWidth = width - rail;
      const centerX = rail + (camera.x + panX) * viewWidth, centerY = (camera.y + panY) * height;
      const cellWidth = columnPitch * zoom, cellHeight = rowPitch * zoom;
      // Keep the overview visible until a grid cell can hold both caption lines.
      const captionRoom = grid ? Math.min(1, Math.max(0, (cellHeight - 42) / 20)) : 1;
      const mix = camera.detail * camera.detail * captionRoom;
      const maxSide = Math.min(viewWidth * .36, height * .36, 210);
      frame.set(layout);
      for (let i = 0; i < photos.length; i++) {
        const k = i * 6;
        frame[k] = rail + viewWidth / 2 + (layout[k] - centerX) * zoom;
        frame[k+1] = height / 2 + (layout[k+1] - centerY) * zoom;
        const scale = Math.min(zoom, maxSide / Math.max(layout[k+2], layout[k+3]));
        frame[k+2] *= scale;
        frame[k+3] *= scale;
        frame[k+5] *= 1 - mix;
      }
      renderer.draw(frame, order);
      field.style.opacity = mix;
      // Reserve space for both caption lines. Give the chosen photo first
      // pick, then use the scene's front-to-back order for crowded neighbors.
      const visible = new Set(), occupied = [];
      function show(i) {
        const k = i * 6, x = frame[k], y = frame[k+1];
        const w = grid ? cellWidth - 10 : frame[k+2];
        const h = grid ? cellHeight - 38 : frame[k+3];
        const left = x - w/2, top = y - h/2;
        const half = Math.max(w/2, captions[photos[i].id][0].length * 3.2) + 4;
        const box = { l: x-half, r: x+half, t: top-3, b: top+h+36 };
        if (box.r < rail || box.l > width || box.b < 0 || box.t > height) return;
        if (!grid && occupied.some(b => b.l < box.r && box.l < b.r && b.t < box.b && box.t < b.b)) return;
        if (!grid) occupied.push(box);
        visible.add(i);
        const figure = nodes.get(i) || makeFigure(i);
        figure.style.transform = 'translate(' + left + 'px,' + top + 'px)';
        figure.style.width = w + 'px';
        figure.style.height = h + 'px';
      }
      if (mix > .01) {
        show(selected);
        for (let n = order.length - 1; n >= 0; n--) if (order[n] !== selected) show(order[n]);
      }
      for (const [i, figure] of nodes) {
        if (visible.has(i)) continue;
        figure.remove();
        nodes.delete(i);
      }
    }

    return {
      get active() { return selected >= 0; },
      get progress() { return camera.detail; },
      setGridPitch(column, row) {
        columnPitch = column;
        rowPitch = row;
      },
      setLayout(next, listVisible, isGrid) {
        if (layout !== next && selected >= 0) reset();
        layout = next;
        grid = isGrid;
        list.hidden = !listVisible;
        if (!listVisible) pendingIndex = -1;
        if (layout && pendingIndex >= 0) {
          const index = pendingIndex;
          pendingIndex = -1;
          select(index);
        }
      },
      resize(w, h) {
        width = w;
        height = h;
        rail = parseFloat(getComputedStyle(list).width);
        return rail;
      },
      draw,
    };
  };
})();
