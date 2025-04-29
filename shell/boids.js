// Constants
const CONFIG = {
  numBoids: 1000, // Number of boids
  perceptionRadius: 50, // Radius within which boids perceive others
  maxSpeed: 7, // Maximum speed of boids
  maxForce: 0.05, // Maximum steering force
  bounceEdges: true, // Toggle for edge behavior: true = bounce, false = wrap around
  scared: 100, // Scared parameter (0 = no deflection, 100 = maximum deflection)
  foresight: 75 // Length of the line representing what boids can see
};

// Global variables
let currentColor = [0.5, 0, 0.5, 1]; // Default purple color in RGBA
let gl; // WebGL context
let canvas;
let boids = [];
let positionBuffer, colorBuffer;
let aPosition, aColor;
let program;
let delaunayMode = false; // Toggle for Delaunay triangulation
let objects = [];
let showPerceptionRadius = false;
let speedColorMode = true; // Toggle for speed-based coloring
let showObjects = true; // Toggle for displaying objects
let gravityEnabled = false; // Toggle for gravity

// Global variables for FPS calculation
let lastFrameTime = performance.now();
let fps = 0;
let lastFpsUpdateTime = performance.now(); // Track the last time the FPS counter was updated

// Global variables for Delaunay triangulation
let delaunayColorsMap = new Map(); // Map to store colors for each triangle based on boid indices

// Boid Class
class Boid {
  constructor(x, y) {
    this.position = vec2.fromValues(x, y); // Use vec2 for position
    this.velocity = vec2.create();
    vec2.random(this.velocity, CONFIG.maxSpeed); // Random velocity
    this.acceleration = vec2.create(); // Zero acceleration
  }

  update() {
    if (gravityEnabled) {
      const gravity = vec2.fromValues(0, 0.1); // Gravity force pointing downward
      this.applyForce(gravity);
    }

    vec2.add(this.velocity, this.velocity, this.acceleration); // velocity += acceleration
    limitVec2(this.velocity, CONFIG.maxSpeed); // Limit velocity
    vec2.add(this.position, this.position, this.velocity); // position += velocity
    vec2.set(this.acceleration, 0, 0); // Reset acceleration
  }

  applyForce(force) {
    vec2.add(this.acceleration, this.acceleration, force); // acceleration += force
  }

  flock(boids) {
    const align = vec2.create();
    const cohesion = vec2.create();
    const separation = vec2.create();
    let total = 0;

    for (let other of boids) {
      const distance = vec2.distance(this.position, other.position);
      if (other !== this && distance < CONFIG.perceptionRadius) {
        vec2.add(align, align, other.velocity); // Alignment
        vec2.add(cohesion, cohesion, other.position); // Cohesion
        const diff = vec2.create();
        vec2.sub(diff, this.position, other.position); // Separation
        vec2.scale(diff, diff, 1 / (distance * distance)); // Weighted by distance
        vec2.add(separation, separation, diff);
        total++;
      }
    }

    if (total > 0) {
      // Alignment
      vec2.scale(align, align, 1 / total);
      vec2.normalize(align, align);
      vec2.scale(align, align, CONFIG.maxSpeed);
      vec2.sub(align, align, this.velocity);
      limitVec2(align, CONFIG.maxForce);

      // Cohesion
      vec2.scale(cohesion, cohesion, 1 / total);
      vec2.sub(cohesion, cohesion, this.position);
      vec2.normalize(cohesion, cohesion);
      vec2.scale(cohesion, cohesion, CONFIG.maxSpeed);
      vec2.sub(cohesion, cohesion, this.velocity);
      limitVec2(cohesion, CONFIG.maxForce);

      // Separation
      vec2.normalize(separation, separation);
      vec2.scale(separation, separation, CONFIG.maxSpeed);
      vec2.sub(separation, separation, this.velocity);
      limitVec2(separation, CONFIG.maxForce);
    }

    this.applyForce(align);
    this.applyForce(cohesion);
    this.applyForce(separation);
  }

  edges() {
    if (CONFIG.bounceEdges) {
      // Bounce off the left or right edges
      if (this.position[0] < 1e-6) {
        this.position[0] = 0;
        this.velocity[0] *= -1; // Reverse x-velocity
      } else if (this.position[0] > canvas.width - 1e-6) {
        this.position[0] = canvas.width;
        this.velocity[0] *= -1; // Reverse x-velocity
      }

      // Bounce off the top or bottom edges
      if (this.position[1] < 1e-6) {
        this.position[1] = 0;
        this.velocity[1] *= -1; // Reverse y-velocity
      } else if (this.position[1] > canvas.height - 1e-6) {
        this.position[1] = canvas.height;
        this.velocity[1] *= -1; // Reverse y-velocity
      }
    } else {
      // Wrap around edges
      if (this.position[0] < 0) {
        this.position[0] = canvas.width;
      } else if (this.position[0] > canvas.width) {
        this.position[0] = 0;
      }

      if (this.position[1] < 0) {
        this.position[1] = canvas.height;
      } else if (this.position[1] > canvas.height) {
        this.position[1] = 0;
      }
    }
  }
}

// Helper Functions
function hexToRGBA(hex) {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = hex; // Attempt to set the color
    const rgbaString = ctx.fillStyle; // Get the computed color value

    // Check if the color is valid
    if (!rgbaString || rgbaString === 'rgba(0, 0, 0, 0)') {
      throw new Error(`Invalid color: ${hex}`);
    }

    const rgba = rgbaString.match(/\d+/g).map(Number); // Extract RGBA values
    return [
      Math.max(rgba[0] / 255, 1e-6),
      Math.max(rgba[1] / 255, 1e-6),
      Math.max(rgba[2] / 255, 1e-6),
      1, // Alpha is always 1
    ];
  } catch (error) {
    console.error(`Invalid color: ${hex}`, error);
    return [1, 0, 0, 1]; // Default to red
  }
}

function toNDC(x, y) {
  return [
    (x / canvas.width) * 2 - 1, // Convert x to range [-1, 1]
    (y / canvas.height) * -2 + 1 // Convert y to range [-1, 1] (invert y-axis)
  ];
}

function toScreenCoordinates(ndcX, ndcY) {
  return [
    ((ndcX + 1) / 2) * canvas.width,  // Convert x from [-1, 1] to [0, canvas.width]
    ((1 - ndcY) / 2) * canvas.height // Convert y from [-1, 1] to [0, canvas.height]
  ];
}

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function limitVec2(vec, max) {
  const length = vec2.length(vec);
  if (length > max) {
    vec2.scale(vec, vec, max / length);
  }
}

function renderDelaunay(positions) {
  // Add four corner vertices to the positions array
  const corners = [
    -1, 1,  // Top-left corner in NDC
    1, 1,   // Top-right corner in NDC
    -1, -1, // Bottom-left corner in NDC
    1, -1   // Bottom-right corner in NDC
  ];
  const extendedPositions = positions.concat(corners);

  // Use Delaunator to compute the triangulation
  const delaunay = new Delaunator(extendedPositions);
  const triangles = delaunay.triangles;

  // Prepare data for rendering
  const triangleVertices = [];
  const triangleColors = [];

  for (let i = 0; i < triangles.length; i += 3) {
    const p1Index = triangles[i];
    const p2Index = triangles[i + 1];
    const p3Index = triangles[i + 2];

    const p1 = extendedPositions.slice(p1Index * 2, p1Index * 2 + 2);
    const p2 = extendedPositions.slice(p2Index * 2, p2Index * 2 + 2);
    const p3 = extendedPositions.slice(p3Index * 2, p3Index * 2 + 2);

    // Add triangle vertices
    triangleVertices.push(...p1, ...p2, ...p3);

    // Generate a unique key for the triangle based on sorted indices
    const triangleKey = [p1Index, p2Index, p3Index].sort((a, b) => a - b).join('-');

    // Check if the triangle already has an assigned color
    if (!delaunayColorsMap.has(triangleKey)) {
      // Generate a pale, transparent color
      const color = [
        Math.random() * 0.6, // Red component (range: 0.7 to 1.0)
        Math.random() * 0.6, // Green component (range: 0.7 to 1.0)
        Math.random() * 0.6, // Blue component (range: 0.7 to 1.0)
        0.5, // Alpha (transparency, range: 0.0 to 1.0, lower = more transparent)
      ];
      delaunayColorsMap.set(triangleKey, color);
    }

    // Retrieve the color for this triangle
    const color = delaunayColorsMap.get(triangleKey);
    triangleColors.push(...color, ...color, ...color);
  }

  // Pass triangle vertices to WebGL
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(triangleVertices), gl.STATIC_DRAW);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPosition);

  // Pass triangle colors to WebGL
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(triangleColors), gl.STATIC_DRAW);
  gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aColor);

  // Draw triangles
  gl.drawArrays(gl.TRIANGLES, 0, triangleVertices.length / 2);
}

function renderObjects() {
  const objectVertices = [];
  const objectColors = [];

  for (const object of objects) {
    for (const triangle of object.triangles) {
      for (const vertex of triangle) {
        objectVertices.push(...vertex);
        objectColors.push(...object.color); // Use the object's color
      }
    }
  }

  // Pass object vertices to WebGL
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(objectVertices), gl.STATIC_DRAW);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPosition);

  // Pass object colors to WebGL
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(objectColors), gl.STATIC_DRAW);
  gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aColor);

  // Draw triangles
  gl.drawArrays(gl.TRIANGLES, 0, objectVertices.length / 2);
}

function renderPerceptionRadius() {
  const circleVertices = [];
  const circleColors = [];
  const lineVertices = [];
  const lineColors = [];
  const numSegments = 50; // Number of segments to approximate the circle

  for (let boid of boids) {
    const centerX = (boid.position[0] / canvas.width) * 2 - 1; // Convert to NDC
    const centerY = (boid.position[1] / canvas.height) * -2 + 1; // Convert to NDC
    const radius = (CONFIG.perceptionRadius / 2 / canvas.width) * 2; // Half the perception radius, converted to NDC

    // Generate vertices for the circle
    for (let i = 0; i <= numSegments; i++) {
      const angle = (i / numSegments) * Math.PI * 2;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      circleVertices.push(x, y);

      // Use a very dark gray color for the circle
      circleColors.push(0.3, 0.3, 0.3, 0.5); // Very dark gray with low transparency
    }

    // Line of sight
    const direction = vec2.clone(boid.velocity);
    vec2.normalize(direction, direction);

    const lineEnd = vec2.clone(boid.position);
    vec2.scaleAndAdd(lineEnd, lineEnd, direction, CONFIG.foresight); // Use foresight for line length

    // Convert to NDC
    const [startX, startY] = toNDC(boid.position[0], boid.position[1]);
    const [endX, endY] = toNDC(lineEnd[0], lineEnd[1]);

    // Add the line vertices
    lineVertices.push(startX, startY, endX, endY);

    // Add the line color (green)
    lineColors.push(0, 1, 0, 1, 0, 1, 0, 1); // Green

    // Check if the endpoint is inside any triangle
    for (let object of objects) {
      for (let triangle of object.triangles) {
        // Convert triangle vertices from NDC to screen coordinates
        const v1 = toScreenCoordinates(triangle[0][0], triangle[0][1]);
        const v2 = toScreenCoordinates(triangle[1][0], triangle[1][1]);
        const v3 = toScreenCoordinates(triangle[2][0], triangle[2][1]);

        // Convert the endpoint from NDC to screen coordinates
        const [screenEndX, screenEndY] = toScreenCoordinates(endX, endY);

        // console.log("Endpoint in screen coordinates:", screenEndX, screenEndY);
        // console.log("Triangle vertices in screen coordinates:", v1, v2, v3);

        if (isPointInTriangle([screenEndX, screenEndY], v1, v2, v3)) {
          console.log("hit");
        }
      }
    }
  }

  // Pass circle vertices to WebGL
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(circleVertices), gl.STATIC_DRAW);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPosition);

  // Pass circle colors to WebGL
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(circleColors), gl.STATIC_DRAW);
  gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aColor);

  // Draw the circles as line loops
  let offset = 0;
  for (let i = 0; i < boids.length; i++) {
    gl.drawArrays(gl.LINE_LOOP, offset, numSegments + 1);
    offset += numSegments + 1;
  }

  // Pass line vertices to WebGL
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineVertices), gl.STATIC_DRAW);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPosition);

  // Pass line colors to WebGL
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineColors), gl.STATIC_DRAW);
  gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aColor);

  // Draw the lines
  for (let i = 0; i < boids.length; i++) {
    gl.drawArrays(gl.LINES, i * 2, 2);
  }
}

function updateConfig(key, value) {
  if (typeof CONFIG[key] !== 'undefined') {
    CONFIG[key] = typeof CONFIG[key] === 'boolean' ? value : parseFloat(value);
  } else {
    switch (key) {
      case 'delaunayMode':
        delaunayMode = value;
        break;
      case 'showPerceptionRadius':
        showPerceptionRadius = value;
        break;
      case 'speedColorMode':
        speedColorMode = value;
        break;
      case 'showObjects':
        showObjects = value;
        break;
      case 'gravityEnabled':
        gravityEnabled = value;
        break;
    }
  }

  // Update the displayed value for sliders
  const valueSpan = document.getElementById(`${key}Value`);
  if (valueSpan) {
    valueSpan.textContent = value;
  }

  // If numBoids changes, reinitialize the boids array
  if (key === 'numBoids') {
    boids = [];
    for (let i = 0; i < CONFIG.numBoids; i++) {
      boids.push(new Boid(Math.random() * canvas.width, Math.random() * canvas.height));
    }
  }
}

function applyPreset(preset) {
  const presets = {
    calm: {
      numBoids: 100,
      perceptionRadius: 50,
      maxSpeed: 3,
      maxForce: 0.2,
      bounceEdges: false,
      delaunayMode: false,
      showPerceptionRadius: false,
      speedColorMode: true,
      showObjects: false,
      gravityEnabled: false,
    },
    chaotic: {
      numBoids: 1000,
      perceptionRadius: 50,
      maxSpeed: 7,
      maxForce: 0.05,
      bounceEdges: true,
      delaunayMode: false,
      showPerceptionRadius: false,
      speedColorMode: true,
      showObjects: false,
      gravityEnabled: false,
    },
  };

  const config = presets[preset];
  if (!config) return;

  // Apply each preset value
  for (const [key, value] of Object.entries(config)) {
    updateConfig(key, value);

    // Update sliders and checkboxes in the UI
    const input = document.getElementById(key);
    if (input) {
      if (input.type === 'checkbox') {
        input.checked = value;
      } else {
        input.value = value;
        const valueSpan = document.getElementById(`${key}Value`);
        if (valueSpan) {
          valueSpan.textContent = value;
        }
      }
    }
  }
}

// Core Functions
function render() {
  gl.clear(gl.COLOR_BUFFER_BIT);

  const now = performance.now();
  const delta = now - lastFrameTime;
  fps = Math.round(1000 / delta); // Calculate FPS
  lastFrameTime = now;

  // Update FPS counter and HUD
  if (now - lastFpsUpdateTime >= 100) {
    const fpsValue = document.getElementById('fpsValue');
    if (fpsValue) {
      fpsValue.textContent = `FPS: ${fps}`;
    }
    lastFpsUpdateTime = now;
  }

  // Update boids
  for (let boid of boids) {
    boid.edges();
    boid.flock(boids);
    boid.update();
  }

  // Perform hit detection if objects are shown
  if (showObjects) {
    checkLineHits();
  }

  // Render perception radius if enabled
  if (showPerceptionRadius) {
    renderPerceptionRadius();
  }

  // Render Delaunay triangulation if enabled
  if (delaunayMode) {
    const positions = boids.map(boid => toNDC(boid.position[0], boid.position[1]));
    renderDelaunay(positions.flat());
  } else {
    // Render boids only if Delaunay mode is off
    const triangleVertices = [];
    const triangleColors = [];
    for (let boid of boids) {
      const direction = vec2.clone(boid.velocity);
      vec2.normalize(direction, direction);

      const tip = vec2.clone(boid.position); // Tip of the triangle
      const baseCenter = vec2.clone(boid.position);
      vec2.scaleAndAdd(tip, tip, direction, 10); // Extend tip in the direction of movement
      vec2.scaleAndAdd(baseCenter, baseCenter, direction, -5); // Move base center backward

      const perpendicular = vec2.fromValues(-direction[1], direction[0]); // Perpendicular vector
      const baseLeft = vec2.clone(baseCenter);
      const baseRight = vec2.clone(baseCenter);
      vec2.scaleAndAdd(baseLeft, baseLeft, perpendicular, -5); // Left base vertex
      vec2.scaleAndAdd(baseRight, baseRight, perpendicular, 5); // Right base vertex

      // Convert to NDC
      const [tipX, tipY] = toNDC(tip[0], tip[1]);
      const [baseLeftX, baseLeftY] = toNDC(baseLeft[0], baseLeft[1]);
      const [baseRightX, baseRightY] = toNDC(baseRight[0], baseRight[1]);

      // Add triangle vertices
      triangleVertices.push(tipX, tipY, baseLeftX, baseLeftY, baseRightX, baseRightY);

      // Calculate speed-based color
      let color = currentColor; // Default color
      if (speedColorMode) {
        const speed = vec2.length(boid.velocity);
        const speedRatio = speed / CONFIG.maxSpeed; // Normalize speed to [0, 1]

        // Interpolate between colors based on speed
        if (speedRatio < 0.5) {
          // Slow: Dark purple/blue
          color = [
            0.2 + speedRatio * 0.6, // Red
            0.0,                   // Green
            0.5 + speedRatio * 0.5, // Blue
            1.0                    // Alpha
          ];
        } else {
          // Fast: Pink
          color = [
            0.5 + (speedRatio - 0.5) * 0.5, // Red
            0.0,                            // Green
            0.5 - (speedRatio - 0.5) * 0.5, // Blue
            1.0                             // Alpha
          ];
        }
      }

      // Add color
      triangleColors.push(...color, ...color, ...color);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(triangleVertices), gl.STATIC_DRAW);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aPosition);

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(triangleColors), gl.STATIC_DRAW);
    gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aColor);

    gl.drawArrays(gl.TRIANGLES, 0, triangleVertices.length / 2);
  }

  // Render objects if enabled
  if (showObjects) {
    renderObjects();
  }

  requestAnimationFrame(render);
}

async function loadObjects() {
  const response = await fetch('objs.json'); // Load the JSON file
  const data = await response.json();
  objects = data.objects;
}

async function main() {
  // WebGL setup
  canvas = document.getElementById('flockCanvas');
  gl = canvas.getContext('webgl'); // Initialize the global WebGL context

  // Set fixed canvas dimensions
  canvas.width = 800;
  canvas.height = 600;

  // Compile shaders and create program
  const vertexShaderSource = `
    attribute vec2 aPosition;
    attribute vec4 aColor;
    varying vec4 vColor;
    void main() {
      gl_PointSize = 5.0;
      gl_Position = vec4(aPosition, 0.0, 1.0);
      vColor = aColor;
    }
  `;
  const fragmentShaderSource = `
    precision mediump float;
    varying vec4 vColor;
    void main() {
      gl_FragColor = vColor;
    }
  `;
  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
  program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  // Get attribute locations
  aPosition = gl.getAttribLocation(program, 'aPosition');
  aColor = gl.getAttribLocation(program, 'aColor');

  // Create buffers
  positionBuffer = gl.createBuffer();
  colorBuffer = gl.createBuffer();

  // Initialize boids
  for (let i = 0; i < CONFIG.numBoids; i++) {
    boids.push(new Boid(Math.random() * canvas.width, Math.random() * canvas.height));
  }

  // Load objects from JSON
  await loadObjects();

  // Add event listeners for toggles
  document.addEventListener('keydown', (event) => {
    if (event.key === 'd' || event.key === 'D') {
      delaunayMode = !delaunayMode; // Toggle Delaunay mode
    }
    if (event.key === 'c' || event.key === 'C') {
      showPerceptionRadius = !showPerceptionRadius; // Toggle perception radius visibility
    }
    if (event.key === 's' || event.key === 'S') {
      speedColorMode = !speedColorMode; // Toggle speed-based coloring
    }
    if (event.key === 'o' || event.key === 'O') {
      showObjects = !showObjects; // Toggle object display
    }
    if (event.key === 'g' || event.key === 'G') {
      gravityEnabled = !gravityEnabled; // Toggle gravity
      document.getElementById('gravityToggle').checked = gravityEnabled; // Sync checkbox state
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'g' || event.key === 'G') {
      gravityEnabled = !gravityEnabled; // Toggle gravity
    }
  });

  // Start rendering
  gl.clearColor(0, 0, 0, 1);
  render();
}

// Run the main function
main();

function isPointInTriangle(point, v1, v2, v3) {
  const [px, py] = point;
  const [x1, y1] = v1;
  const [x2, y2] = v2;
  const [x3, y3] = v3;

  const area = 0.5 * (-y2 * x3 + y1 * (-x2 + x3) + x1 * (y2 - y3) + x2 * y3);
  const s = 1 / (2 * area) * (y1 * x3 - x1 * y3 + (y3 - y1) * px + (x1 - x3) * py);
  const t = 1 / (2 * area) * (x1 * y2 - y1 * x2 + (y1 - y2) * px + (x2 - x1) * py);

  return s > 0 && t > 0 && 1 - s - t > 0;
}

function checkLineHits() {
  for (let boid of boids) {
    // Line of sight
    const direction = vec2.clone(boid.velocity);
    vec2.normalize(direction, direction);

    const lineEnd = vec2.clone(boid.position);
    vec2.scaleAndAdd(lineEnd, lineEnd, direction, CONFIG.foresight); // Use foresight for line length

    // Convert the endpoint from NDC to screen coordinates
    const [endX, endY] = toNDC(lineEnd[0], lineEnd[1]);
    const [screenEndX, screenEndY] = toScreenCoordinates(endX, endY);

    // Check if the endpoint is inside any triangle
    for (let object of objects) {
      for (let triangle of object.triangles) {
        const v1 = toScreenCoordinates(triangle[0][0], triangle[0][1]);
        const v2 = toScreenCoordinates(triangle[1][0], triangle[1][1]);
        const v3 = toScreenCoordinates(triangle[2][0], triangle[2][1]);

        if (isPointInTriangle([screenEndX, screenEndY], v1, v2, v3)) {
          console.log("hit");

          // Apply a deflection force to the left or right
          const deflection = vec2.create();
          const randomFactor = Math.random() * CONFIG.scared; // Random deflection strength
          const directionFactor = Math.random() < 0.5 ? -1 : 1; // Randomly choose left (-1) or right (1)
          vec2.set(deflection, directionFactor * direction[1], -directionFactor * direction[0]); // Perpendicular to the direction
          vec2.scale(deflection, deflection, randomFactor * CONFIG.maxForce);

          boid.applyForce(deflection); // Apply the deflection force
        }
      }
    }
  }
}