
// Constants
const CONFIG = {
  numBoids: 100,
  perceptionRadius: 50,
  maxSpeed: 1,
  maxForce: 0.05,
  keyColors: {
    '0': 'white', '1': 'red', '2': 'orange', '3': 'yellow',
    '4': 'green', '5': 'cyan', '6': 'blue',
    '7': 'purple', '8': 'pink', '9': 'gray'
  }
};

let currentColor = [0.5, 0, 0.5, 1]; // Default purple color in RGBA
let delaunayEnabled = false;
let voronoiEnabled = false;

// Classes
class Vector {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  add(v) {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  mult(n) {
    this.x *= n;
    this.y *= n;
    return this;
  }

  div(n) {
    this.x /= n;
    this.y /= n;
    return this;
  }

  setMag(m) {
    return this.normalize().mult(m);
  }

  normalize() {
    const mag = this.mag();
    return mag ? this.div(mag) : this;
  }

  limit(max) {
    return this.mag() > max ? this.setMag(max) : this;
  }

  mag() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  dist(v) {
    return Math.sqrt((this.x - v.x) ** 2 + (this.y - v.y) ** 2);
  }

  static sub(a, b) {
    return new Vector(a.x - b.x, a.y - b.y);
  }

  static random() {
    let angle = Math.random() * 2 * Math.PI;
    return new Vector(Math.cos(angle), Math.sin(angle));
  }
}

class Boid {
  constructor(x, y) {
    this.position = new Vector(x, y);
    this.velocity = Vector.random().mult(CONFIG.maxSpeed);
    this.acceleration = new Vector(0, 0);
  }

  update() {
    this.velocity.add(this.acceleration).limit(CONFIG.maxSpeed);
    this.position.add(this.velocity);
    this.acceleration.mult(0);
  }

  applyForce(force) {
    this.acceleration.add(force);
  }

  flock(boids) {
    let align = new Vector(0, 0),
      cohesion = new Vector(0, 0),
      separation = new Vector(0, 0);
    let total = 0;
    for (let other of boids) {
      const d = this.position.dist(other.position);
      if (other !== this && d < CONFIG.perceptionRadius) {
        align.add(other.velocity);
        cohesion.add(other.position);
        let diff = Vector.sub(this.position, other.position).div(d * d);
        separation.add(diff);
        total++;
      }
    }
    if (total > 0) {
      align.div(total).setMag(CONFIG.maxSpeed).sub(this.velocity).limit(CONFIG.maxForce);
      cohesion.div(total).sub(this.position).setMag(CONFIG.maxSpeed).sub(this.velocity).limit(CONFIG.maxForce);
      separation.div(total).setMag(CONFIG.maxSpeed).sub(this.velocity).limit(CONFIG.maxForce);
    }
    this.applyForce(align);
    this.applyForce(cohesion);
    this.applyForce(separation);
  }

  edges() {
    if (this.position.x < 0) this.position.x = canvas.width;
    if (this.position.x > canvas.width) this.position.x = 0;
    if (this.position.y < 0) this.position.y = canvas.height;
    if (this.position.y > canvas.height) this.position.y = 0;
  }
}

// Helper Functions
function hexToRGBA(hex) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = hex;
  const rgba = ctx.fillStyle.match(/\d+/g).map(Number);
  return [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, 1];
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

// Core Functions
function render() {
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Draw boids
  const positions = [];
  for (let boid of boids) {
    boid.edges();
    boid.flock(boids);
    boid.update();
    const [ndcX, ndcY] = toNDC(boid.position.x, boid.position.y);
    positions.push(ndcX, ndcY);
  }

  // Pass positions to WebGL
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPosition);

  // Set color and draw points
  gl.uniform4fv(uColor, currentColor);
  gl.drawArrays(gl.POINTS, 0, boids.length);

  requestAnimationFrame(render);
}

// Main Function
function main() {
  // WebGL setup
  const canvas = document.getElementById('flockCanvas');
  const gl = canvas.getContext('webgl');

  // Set canvas dimensions
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // Shader sources
  const vertexShaderSource = `
    attribute vec2 aPosition;
    uniform vec4 uColor;
    void main() {
      gl_PointSize = 5.0;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;
    uniform vec4 uColor;
    void main() {
      gl_FragColor = uColor;
    }
  `;

  // Compile shaders and create program
  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  // Get attribute and uniform locations
  const aPosition = gl.getAttribLocation(program, 'aPosition');
  const uColor = gl.getUniformLocation(program, 'uColor');

  // Initialize boids
  const boids = [];
  for (let i = 0; i < CONFIG.numBoids; i++) {
    boids.push(new Boid(Math.random() * canvas.width, Math.random() * canvas.height));
  }

  // Start rendering
  gl.clearColor(0, 0, 0, 1);
  render();
}

// Run the main function
main();