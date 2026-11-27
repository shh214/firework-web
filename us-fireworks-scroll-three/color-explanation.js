(() => {
  "use strict";

  // The formulas are representative colorants. The crop values frame each original cutout.
  // https://www.acs.org/content/dam/acsorg/education/students/highschool/chemistryclubs/July_ChemClubCal.pdf
  // https://inchemistry.acs.org/atomic-news/the-boom-in-fireworks.html
  const colors = [
    ["brilliant_orange", "2638268119", "CaCl₂", "Brilliant orange", [190, 47, 57]],
    ["deep_red", "3689615371", "SrCO₃", "Deep red", [100, 50, 50]],
    ["silvery_white", "183144473", "Ti / Mg", "Silvery white", [142, 49, 39]],
    ["lavender", "185773120", "SrCO₃ + CuCl", "Lavender", [137, 58, 56]],
    ["yellow", "185772909", "NaCl", "Yellow", [122, 57, 47]],
    ["bright_green", "55425461232", "BaCl₂", "Bright green", [380, 83, 45]],
    ["blue", "19345201070", "CuCl", "Blue", [130, 43, 36]],
  ];
  const assetPath = "assets/color-explanation/";
  const firstColorStep = 2;
  const overviewStep = firstColorStep + colors.length;
  const pointStep = overviewStep + 1;
  const readingTime = 1000;
  const wheelThreshold = 140;
  const wheelAccumulationGap = 500;

  function createChapterScroll(showStep) {
    let start, end;
    let step = -1, readyAt = 0;
    let lastWheel = -Infinity, wheelDirection = 0, wheelDistance = 0;
    let touch;
    const isAnchored = () => step <= pointStep;
    const anchor = () => step < 0 ? 0 : Math.round(start + (end - start) * step / pointStep);

    function scrollTo(top) {
      if (Math.abs(window.scrollY - top) >= 1) window.scrollTo({ top, behavior: "instant" });
    }

    function select(next, immediate = false) {
      step = next;
      readyAt = performance.now() + readingTime;
      wheelDistance = 0;
      showStep(step, immediate);
      if (isAnchored()) scrollTo(anchor());
    }

    function entersFromCities(direction, distance) {
      return direction < 0 && window.scrollY - distance <= end;
    }

    function advance(direction) {
      if (!isAnchored()) {
        select(pointStep);
        return;
      }
      if (step === -1 && direction < 0) return;
      if (step >= 0 && direction > 0 && performance.now() < readyAt) return;
      select(step + direction);
      if (!isAnchored()) scrollTo(end + 1);
    }

    // Catch native scrolling that can arrive without a cancelable input event,
    // such as touch inertia or a scrollbar drag across the entire chapter.
    function onScroll() {
      if (start === undefined) return;
      if (step === -1 && window.scrollY > 0) select(0);
      else if (isAnchored()) scrollTo(anchor());
      else if (entersFromCities(-1, 0)) select(pointStep);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", event => {
      if (start === undefined || event.defaultPrevented || event.ctrlKey || event.metaKey
          || Math.abs(event.deltaX) > Math.abs(event.deltaY) || !event.deltaY) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
      const direction = Math.sign(delta);
      const distance = Math.abs(delta);
      const now = performance.now();
      if (!isAnchored()) {
        if (entersFromCities(direction, distance)) {
          event.preventDefault();
          advance(direction);
        }
        return;
      }
      if (step === -1 && direction < 0) return;
      event.preventDefault();
      // Count wheel input only after the reading interval. Continuing to roll
      // can advance the chapter, but input from the interval cannot build up.
      if (step >= 0 && direction > 0 && now < readyAt) return;
      if (now - lastWheel > wheelAccumulationGap || direction !== wheelDirection) wheelDistance = 0;
      lastWheel = now;
      wheelDirection = direction;
      wheelDistance += distance;
      if (wheelDistance < wheelThreshold) return;
      advance(direction);
    }, { passive: false });

    window.addEventListener("touchstart", event => {
      const finger = event.touches[0];
      touch = event.touches.length === 1 ? { x: finger.clientX, y: finger.clientY, used: false } : null;
    }, { passive: true });
    window.addEventListener("touchmove", event => {
      if (start === undefined || !touch || event.touches.length !== 1) return;
      const finger = event.touches[0];
      const delta = touch.y - finger.clientY;
      const distance = Math.abs(delta);
      if (!touch.used && (distance <= Math.abs(finger.clientX - touch.x) || !distance)) return;
      const direction = Math.sign(delta);
      if (!touch.used && (step === -1 && direction < 0
          || !isAnchored() && !entersFromCities(direction, distance))) return;
      if (!event.cancelable) return;
      event.preventDefault();
      if (touch.used || distance < 48) return;
      touch.used = true;
      advance(direction);
    }, { passive: false });

    window.addEventListener("keydown", event => {
      if (start === undefined || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
          || event.target.closest?.("button, a, input, textarea, select, [contenteditable]")) return;
      const direction = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 }[event.key]
        ?? (event.key === " " ? (event.shiftKey ? -1 : 1) : 0);
      if (!direction) return;
      const distance = event.key.startsWith("Arrow") ? 40 : window.innerHeight;
      if (step === -1 && direction < 0 || !isAnchored() && !entersFromCities(direction, distance)) return;
      event.preventDefault();
      if (!event.repeat) advance(direction);
    });

    return {
      get atCities() { return !isAnchored(); },
      resize(nextStart, nextEnd) {
        const firstLayout = start === undefined;
        start = nextStart;
        end = nextEnd;
        if (firstLayout) {
          const y = window.scrollY;
          const initial = y <= 0 ? -1 : y > end ? pointStep + 1
            : Math.max(0, Math.round(pointStep * (y - start) / (end - start)));
          select(initial, true);
        } else if (isAnchored()) {
          scrollTo(anchor());
        } else if (window.scrollY <= end) {
          scrollTo(end + 1);
        }
      },
    };
  }

  window.createColorExplanation = function (section, circles, photoIndex, smooth, reducedMotion, requestDraw) {
    const question = section.querySelector(".color-question");
    const gallery = section.querySelector(".color-gallery");
    const captions = section.querySelector(".color-captions");
    const summary = section.querySelector(".color-summary");
    const pointCaption = section.querySelector(".color-point-caption");
    const slots = colors.map(([family, id, formula, name, [zoom, centerX, centerY]]) => {
      const index = photoIndex.get(id);
      if (circles[index]?.family !== family) {
        throw new Error("Color explanation point does not match the circle layout: " + family);
      }

      const slot = document.createElement("div");
      slot.className = "color-slot";
      const burst = document.createElement("div");
      burst.className = "color-burst";
      const picture = new Image();
      picture.alt = "";
      picture.src = assetPath + id + ".png";
      picture.style.width = zoom + "%";
      picture.style.transform = `translate(-${centerX}%, -${centerY}%)`;
      burst.append(picture);
      slot.append(burst);
      gallery.append(slot);

      const caption = document.createElement("p");
      caption.className = "color-caption";
      caption.setAttribute("aria-hidden", "true");
      const heading = document.createElement("strong");
      heading.textContent = formula;
      caption.append(heading, " · " + name);
      captions.append(caption);
      return { index, slot, burst, caption, x: 0, y: 0, diameter: 0 };
    });

    const animation = { matrixTravel: 0, matrixOpacity: 1, collapse: 0, cityArrival: 0 };
    let previousStep = -1;
    const scroll = createChapterScroll(showStep);
    function resize(width, height) {
      const inset = width * .08;
      const spacing = (width - inset * 2) / (slots.length - 1);
      const burstSize = Math.min(spacing * .86, height * .126, 130);
      section.style.setProperty("--burst-size", burstSize + "px");
      slots.forEach((entry, i) => {
        entry.x = inset + i * spacing;
        entry.y = height * .51;
        entry.diameter = Math.min(spacing * .42, Math.max(12, Math.min(width, height) * .028));
        entry.slot.style.left = entry.x + "px";
        entry.slot.style.top = entry.y + "px";
      });
    }

    function setAnimation(property, value, duration, ease, immediate) {
      gsap.killTweensOf(animation, property);
      if (immediate) animation[property] = value;
      else if (animation[property] !== value) {
        gsap.to(animation, {
          [property]: value,
          duration: reducedMotion.matches ? .15 : duration,
          ease,
          onUpdate: requestDraw,
        });
      }
    }

    function showStep(step, immediate) {
      const explaining = step >= firstColorStep && step < overviewStep;
      const questionVisible = step === 1;
      const allVisible = step === overviewStep;
      const pointsVisible = step === pointStep;
      section.dataset.mode = questionVisible ? "question" : explaining ? "explain"
        : allVisible ? "together" : pointsVisible ? "points" : "outside";
      question.setAttribute("aria-hidden", String(!questionVisible));
      summary.setAttribute("aria-hidden", String(!allVisible));
      pointCaption.setAttribute("aria-hidden", String(!pointsVisible));
      slots.forEach(({ burst, caption }, i) => {
        const selected = explaining && i === step - firstColorStep;
        burst.classList.toggle("is-lit", selected || step >= overviewStep);
        caption.classList.toggle("is-selected", selected);
        caption.setAttribute("aria-hidden", String(!selected));
      });

      if (immediate || (step >= 0) !== (previousStep >= 0)) {
        setAnimation("matrixTravel", Number(step >= 0), step >= 0 ? 1.35 : .85, "none", immediate);
      }
      if (immediate || (step <= 0) !== (previousStep <= 0)) {
        setAnimation("matrixOpacity", Number(step <= 0), .55, "power2.inOut", immediate);
      }
      if (immediate || (step >= pointStep) !== (previousStep >= pointStep)) {
        setAnimation("collapse", Number(step >= pointStep), .64, "power2.inOut", immediate);
      }
      if (immediate || (step > pointStep) !== (previousStep > pointStep)) {
        setAnimation("cityArrival", Number(step > pointStep), step > pointStep ? 1.35 : .85, "none", immediate);
      }
      previousStep = step;
      requestDraw();
    }

    function readFrame() {
      const { matrixTravel, matrixOpacity, collapse, cityArrival } = animation;
      gallery.style.setProperty("--burst-scale", reducedMotion.matches ? "1" : String(1 - .82 * collapse));
      gallery.style.setProperty("--burst-visibility", String(1 - collapse));
      return { matrixTravel, matrixOpacity, cityArrival, pointOpacity: smooth((collapse - .22) / .78) };
    }

    return { slots, scroll, resize, readFrame, get atSphere() { return previousStep === -1 && animation.matrixTravel === 0; } };
  };
})();
