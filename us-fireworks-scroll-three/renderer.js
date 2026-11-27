(() => {
  "use strict";

  function atlasFrames({ atlas, photos }) {
    return photos.map(({ w, h }, i) => {
      const scale = atlas.cell / Math.max(w, h);
      const width = Math.max(1, Math.round(w * scale));
      const height = Math.max(1, Math.round(h * scale));
      const x = (i % atlas.cols) * atlas.cell + Math.floor((atlas.cell - width) / 2);
      const y = Math.floor(i / atlas.cols) * atlas.cell + Math.floor((atlas.cell - height) / 2);
      return { x, y, width, height };
    });
  }

  function resampleAtlas(image, ratio) {
    if (ratio === 1) return image;
    const sheet = document.createElement("canvas");
    sheet.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    sheet.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = sheet.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, sheet.width, sheet.height);
    return sheet;
  }

  function canvasPainter(canvas, image, frames, cell, colors, opacity) {
    const ctx = canvas.getContext("2d", { alpha: false });
    const sheets = [...new Set([Math.min(18, cell), Math.min(40, cell), cell])].map(size => ({
      size, ratio: size / cell, image: resampleAtlas(image, size / cell),
    }));
    let width, height, dpr;
    return {
      resize(w, h, ratio) {
        width = w;
        height = h;
        dpr = ratio;
        ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
      },
      draw(frame, order, morph = 0) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        const tintAlpha = morph * opacity;
        const photoWeight = morph < 1 ? (1 - morph) / (1 - tintAlpha) : 0;
        for (let n = 0; n < order.length; n++) {
          const i = order[n], k = i * 6;
          const w = frame[k+2], h = frame[k+3];
          const x = frame[k] - w / 2, y = frame[k+1] - h / 2;
          if (w <= 0 || h <= 0 || x >= width || y >= height || x + w <= 0 || y + h <= 0) continue;
          const side = Math.max(w, h) * dpr;
          const sheet = side <= sheets[0].size ? sheets[0]
            : side <= sheets[1].size ? sheets[1] : sheets[sheets.length - 1];
          const rect = frames[i], r = sheet.ratio;
          const light = frame[k+5];
          if (morph > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, Math.min(w, h) * morph / 2);
            ctx.clip();
            if (morph < 1) {
              ctx.globalAlpha = light * photoWeight;
              ctx.drawImage(sheet.image, rect.x*r, rect.y*r, rect.width*r, rect.height*r, x, y, w, h);
            }
            ctx.globalAlpha = tintAlpha;
            ctx.fillStyle = colors[i].color;
            ctx.fillRect(x, y, w, h);
            ctx.restore();
            continue;
          }
          ctx.globalAlpha = light;
          ctx.drawImage(sheet.image, rect.x*r, rect.y*r, rect.width*r, rect.height*r, x, y, w, h);
        }
      },
    };
  }

  function makeProgram(gl) {
    const vert = `#version 300 es
      layout(location=0) in vec4 aRect;
      layout(location=1) in vec4 aTexture;
      layout(location=2) in float aLight;
      layout(location=3) in vec3 aTint;
      out vec3 tint;
      out vec2 local;
      flat out vec2 halfSize;
      uniform vec2 uView;
      out vec2 uv;
      out float light;
      void main() {
        vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
        vec2 xy = (aRect.xy + (corner - 0.5) * aRect.zw) / uView;
        gl_Position = vec4(xy.x * 2.0 - 1.0, 1.0 - xy.y * 2.0, 0.0, 1.0);
        uv = mix(aTexture.xy, aTexture.zw, corner);
        light = aLight;
        tint = aTint;
        halfSize = aRect.zw * .5;
        local = (corner - .5) * aRect.zw;
      }`;
    const frag = `#version 300 es
      precision highp float;
      uniform sampler2D uAtlas;
      in vec2 uv;
      in float light;
      in vec2 local;
      flat in vec2 halfSize;
      in vec3 tint;
      uniform float uMorph;
      uniform float uOpacity;
      out vec4 color;
      void main() {
        vec4 photo = texture(uAtlas, uv) * light;
        float radius = min(halfSize.x, halfSize.y) * uMorph;
        vec2 d = abs(local) - halfSize + radius;
        float distanceToEdge = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
        float aa = max(fwidth(distanceToEdge), .0001);
        float mask = uMorph == 0.0 ? 1.0 : clamp(.5 - distanceToEdge / aa, 0.0, 1.0);
        color = mask * mix(photo, vec4(tint * uOpacity, uOpacity), uMorph);
      }`;
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, frag]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "Could not link photo shaders");
    }
    return program;
  }

  function webglPainter(gl, image, frames, cell, colors, opacity) {
    const program = makeProgram(gl);
    gl.useProgram(program);
    const view = gl.getUniformLocation(program, "uView");
    const morphUniform = gl.getUniformLocation(program, "uMorph");
    gl.uniform1f(gl.getUniformLocation(program, "uOpacity"), opacity);
    const rgb = colors.map(({color}) => [1,3,5].map(i => parseInt(color.slice(i,i+2),16)/255));
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const largest = Math.max(image.naturalWidth, image.naturalHeight);
    const ratio = Math.min(cell, Math.floor(cell * maxTexture / largest)) / cell;
    if (!ratio) throw new Error("Photo atlas exceeds texture limits");
    const sheet = resampleAtlas(image, ratio);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sheet);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (gl.getError() !== gl.NO_ERROR) throw new Error("Could not allocate the photo atlas");
    const uvs = frames.map(({ x, y, width, height }) => [
      (x + 0.5) / image.naturalWidth, (y + 0.5) / image.naturalHeight,
      (x + width - 0.5) / image.naturalWidth, (y + height - 0.5) / image.naturalHeight,
    ]);
    // Instance order is the supplied painter's order. Overlap is exact even
    // when neighboring depths differ by less than one depth-buffer unit.
    const data = new Float32Array(frames.length * 12);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    for (const [attribute, size, start] of [[0, 4, 0], [1, 4, 4], [2, 1, 8], [3, 3, 9]]) {
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, 48, start * 4);
      gl.vertexAttribDivisor(attribute, 1);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 1);
    return {
      resize(width, height) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.uniform2f(view, width, height);
      },
      draw(frame, order, morph = 0) {
        for (let n = 0; n < order.length; n++) {
          const i = order[n], k = i * 6, p = n * 12;
          data[p] = frame[k];      data[p+1] = frame[k+1];
          data[p+2] = frame[k+2];  data[p+3] = frame[k+3];
          data.set(rgb[i], p+9);   data.set(uvs[i], p+4);   data[p+8] = frame[k+5];
        }
        gl.uniform1f(morphUniform, morph);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, order.length);
      },
    };
  }

  window.createFireworkRenderer = function (canvas, atlasImage, cloudData, colors, opacity) {
    const frames = atlasFrames(cloudData);
    let surface = canvas, painter, gl;
    let width = 1, height = 1, ratio = 1, lastFrame, lastOrder, lastMorph;

    function resize(w, h, dpr) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      ratio = Math.max(1, dpr);
      if (surface !== canvas) {
        // A browser cannot give a WebGL canvas a 2D context. Keep the
        // original node as the pointer target and put a display layer over it.
        const fixed = getComputedStyle(canvas).position === "fixed";
        const rect = canvas.getBoundingClientRect();
        Object.assign(surface.style, {
          position: fixed ? "fixed" : "absolute", pointerEvents: "none",
          left: (fixed ? rect.left : canvas.offsetLeft) + "px",
          top: (fixed ? rect.top : canvas.offsetTop) + "px",
          width: width + "px", height: height + "px", zIndex: getComputedStyle(canvas).zIndex,
        });
      }
      const px = Math.round(width * ratio), py = Math.round(height * ratio);
      if (surface.width !== px) surface.width = px;
      if (surface.height !== py) surface.height = py;
      painter.resize(width, height, ratio);
    }
    function useCanvas() {
      if (gl) {
        surface = document.createElement("canvas");
        surface.setAttribute("aria-hidden", "true");
        canvas.after(surface);
      }
      painter = canvasPainter(surface, atlasImage, frames, cloudData.atlas.cell, colors, opacity);
      resize(width, height, ratio);
      if (lastFrame) painter.draw(lastFrame, lastOrder, lastMorph);
    }
    if (location.protocol !== "file:") {
      try {
        gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
        if (gl) painter = webglPainter(gl, atlasImage, frames, cloudData.atlas.cell, colors, opacity);
      } catch (error) {
        console.warn("Using the 2D photo renderer.", error);
      }
    }
    if (!painter) {
      useCanvas();
    } else {
      canvas.addEventListener("webglcontextlost", event => {
        event.preventDefault();
        useCanvas();
      }, { once: true });
    }
    return {
      resize,
      draw(frame, order, morph = 0) {
        lastFrame = frame;
        lastOrder = order;
        lastMorph = morph;
        painter.draw(frame, order, morph);
      },
    };
  };
})();
