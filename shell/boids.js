// Constants
const CONFIG = {
  numBoids: 1000, // Number of boids
  perceptionRadius: 50, // Radius within which boids perceive others
  maxSpeed: 1, // Maximum speed of boids
  maxForce: 0.05 // Maximum steering force
};

// Global variables
let currentColor = [0.5, 0, 0.5, 1]; // Default purple color in RGBA
let gl; // WebGL context
let canvas;
let boids = [];
let positionBuffer, colorBuffer;
let aPosition, aColor;
let program;

// Global variables for FPS calculation
let lastFrameTime = performance.now();
let fps = 0;
let lastFpsUpdateTime = performance.now(); // Track the last time the FPS counter was updated

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
    if (this.position[0] < 0) this.position[0] = canvas.width;
    if (this.position[0] > canvas.width) this.position[0] = 0;
    if (this.position[1] < 0) this.position[1] = canvas.height;
    if (this.position[1] > canvas.height) this.position[1] = 0;
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

// Core Functions
function render() {
  const now = performance.now();
  const delta = now - lastFrameTime;
  fps = Math.round(1000 / delta); // Calculate FPS
  lastFrameTime = now;

  // Update FPS counter only 10 times per second
  if (now - lastFpsUpdateTime >= 100) {
    const fpsCounter = document.getElementById('fpsCounter');
    if (fpsCounter) {
      fpsCounter.textContent = `FPS: ${fps}`;
    }
    lastFpsUpdateTime = now;
  }

  gl.clear(gl.COLOR_BUFFER_BIT);

  // Prepare position and color data
  const positions = [];
  const colors = [];
  for (let boid of boids) {
    boid.edges();
    boid.flock(boids);
    boid.update();
    const [ndcX, ndcY] = toNDC(boid.position[0], boid.position[1]);
    positions.push(ndcX, ndcY);

    // Add the current color for each boid
    colors.push(...currentColor);
  }

  // Pass positions to WebGL
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPosition);

  // Pass colors to WebGL
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
  gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aColor);

  // Draw points
  gl.drawArrays(gl.POINTS, 0, boids.length);

  requestAnimationFrame(render);
}

function main() {
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

  // Start rendering
  gl.clearColor(0, 0, 0, 1);
  render();
}

// Run the main function
main();