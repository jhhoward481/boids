// Constants
const CONFIG = {
  numBoids: 1000, // Number of boids
  perceptionRadius: 50, // Radius within which boids perceive others
  maxSpeed: 1, // Maximum speed of boids
  maxForce: 0.05, // Maximum steering force
  bounceEdges: false, // Toggle for edge behavior: true = bounce, false = wrap around
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

// Core Functions
function render() {
  const now = performance.now();
  const delta = now - lastFrameTime;
  fps = Math.round(1000 / delta); // Calculate FPS
  lastFrameTime = now;

  // Update FPS counter only 10 times per second
  if (now - lastFpsUpdateTime >= 100) {
    const fpsValue = document.getElementById('fpsValue');
    const delaunayIndicator = document.getElementById('delaunayIndicator');

    if (fpsValue) {
      fpsValue.textContent = `FPS: ${fps}`;
    }

    if (delaunayIndicator) {
      delaunayIndicator.style.display = delaunayMode ? 'block' : 'none';
    }

    lastFpsUpdateTime = now;
  }

  gl.clear(gl.COLOR_BUFFER_BIT);

  // Prepare position data for Delaunay triangulation
  const positions = [];
  const triangleVertices = [];
  const triangleColors = [];

  for (let boid of boids) {
    boid.edges();
    boid.flock(boids);
    boid.update();

    // Add boid position to positions array for Delaunay triangulation
    positions.push(boid.position[0], boid.position[1]);

    // Calculate triangle vertices for the boid
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

    // Add color for the triangle
    triangleColors.push(...currentColor, ...currentColor, ...currentColor);
  }

  if (delaunayMode) {
    // Render Delaunay triangulation
    const ndcPositions = positions.map((value, index) =>
      index % 2 === 0 ? (value / canvas.width) * 2 - 1 : (value / canvas.height) * -2 + 1
    );
    renderDelaunay(ndcPositions);
  } else {
    // Render boids as triangles
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

  // Render objects
  renderObjects();

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

  // Add event listener for the D key
  document.addEventListener('keydown', (event) => {
    if (event.key === 'd' || event.key === 'D') {
      delaunayMode = !delaunayMode; // Toggle Delaunay mode
    }
  });

  // Start rendering
  gl.clearColor(0, 0, 0, 1);
  render();
}

// Run the main function
main();