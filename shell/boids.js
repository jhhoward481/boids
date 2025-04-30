// Constants
const CONFIG = {
  numBoids: 100, // Number of boids
  perceptionRadius: 50, // Radius within which boids perceive others
  maxSpeed: 3, // Maximum speed of boids
  maxForce: 0.2, // Maximum steering force
  bounceEdges: false, // Toggle for edge behavior: true = bounce, false = wrap around
  scared: 100, // Scared parameter (0 = no deflection, 100 = maximum deflection)
  foresight: 120, // Length of the line representing what boids can see
  gradientKeys: [
    { position: 0, color: "#3AB795" }, // Green at the top
    { position: 0.5, color: "#FFCF56" }, // Yellow in the middle
    { position: 1, color: "#FF5733" } // Red at the bottom
  ],
  showTrails: false, // Toggle for showing trails
  trailLength: 50 // Increase the trail length
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
let showObjects = false; // Toggle for displaying objects
let gravityEnabled = false; // Toggle for gravity
let boidTrails = []; // Array of arrays to store trails for each boid

// Global variables for FPS calculation
let lastFrameTime = performance.now();
let fps = 0;
let lastFpsUpdateTime = performance.now(); // Track the last time the FPS counter was updated

// Global variables for Delaunay triangulation
let delaunayColorsMap = new Map(); // Map to store colors for each triangle based on boid indices

// Boid Class
class Boid {
  constructor(x, y, index) {
    this.position = vec2.fromValues(x, y);
    this.velocity = vec2.fromValues(Math.random() * 2 - 1, Math.random() * 2 - 1);
    this.acceleration = vec2.create();
    this.index = index; // Assign index
  }

  update() {
    vec2.add(this.velocity, this.velocity, this.acceleration); // velocity += acceleration
    limitVec2(this.velocity, CONFIG.maxSpeed); // Limit velocity
    vec2.add(this.position, this.position, this.velocity); // position += velocity
    vec2.set(this.acceleration, 0, 0); // Reset acceleration

    // Calculate the current color based on speed if speed-based coloring is enabled
    let color = currentColor; // Default color
    if (speedColorMode) {
      const speed = vec2.length(this.velocity);
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

    // Add the current position and color to the trail
    if (CONFIG.showTrails) {
      const trail = boidTrails[this.index];
      trail.push({ position: vec2.clone(this.position), color: [...color] });

      // Remove the oldest position if the trail exceeds the maximum length
      if (trail.length > CONFIG.trailLength) {
        trail.shift();
      }
    }
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
  // Remove the hash (#) if it exists
  hex = hex.replace(/^#/, '');

  // Parse the hex string into RGB components
  const bigint = parseInt(hex, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;

  // Return the RGBA array with alpha set to 1
  return [r / 255, g / 255, b / 255, 1];
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
    -1.25, 1.25,  // Top-left corner in NDC
    1.25, 1.25,   // Top-right corner in NDC
    -1.25, -1.25, // Bottom-left corner in NDC
    1.25, -1.25   // Bottom-right corner in NDC
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

    // Calculate the orthocenter (approximation: average of vertices)
    const orthocenterX = (p1[0] + p2[0] + p3[0]) / 3;
    const orthocenterY = (p1[1] + p2[1] + p3[1]) / 3;

    // Map the orthocenter's Y-coordinate to a normalized value [0, 1]
    // Reverse the Y-axis so 0 corresponds to the top and 1 corresponds to the bottom
    const normalizedY = (1 - orthocenterY) / 2; // Normalize Y from [-1, 1] to [0, 1]

    // Interpolate between gradient keys
    const gradientColor = interpolateGradient(normalizedY, CONFIG.gradientKeys);

    // Add the same color for all three vertices of the triangle
    triangleColors.push(...gradientColor, ...gradientColor, ...gradientColor);
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
    if (key === 'gradientTopColor' || key === 'gradientBottomColor') {
      CONFIG[key] = value; // Update the color directly as a hex string
    } else {
      CONFIG[key] = typeof CONFIG[key] === 'boolean' ? value : parseFloat(value);
    }
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
    boidTrails = []; // Reset trails
    for (let i = 0; i < CONFIG.numBoids; i++) {
      boids.push(new Boid(Math.random() * canvas.width, Math.random() * canvas.height, i));
      boidTrails.push([]); // Initialize an empty trail for each boid
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
      gradientKeys: [
        { position: 0, color: "#3AB795" },
        { position: 0.5, color: "#FFCF56" },
        { position: 1, color: "#FF5733" }
      ]
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
      gradientKeys: [
        { position: 0, color: "#ffff00" },
        { position: 0.5, color: "#00ffff" },
        { position: 1, color: "#ff00ff" }
      ]
    },
    space: {
      numBoids: 500,
      perceptionRadius: 60,
      maxSpeed: 5,
      maxForce: 0.1,
      bounceEdges: true,
      delaunayMode: true,
      showPerceptionRadius: false,
      speedColorMode: false,
      showObjects: false,
      gravityEnabled: false,
      gradientKeys: [
        { position: 0, color: "#000000" },
        { position: 0.3, color: "#1B1F4A" },
        { position: 0.6, color: "#4A4E9A" },
        { position: 1, color: "#FFFFFF" }
      ]
    },
    landscape: {
      numBoids: 300,
      perceptionRadius: 70,
      maxSpeed: 4,
      maxForce: 0.15,
      bounceEdges: false,
      delaunayMode: true,
      showPerceptionRadius: false,
      speedColorMode: true,
      showObjects: false,
      gravityEnabled: false,
      gradientKeys: [
        { position: 0, color: "#87CEEB" },
        { position: 0.1, color: "#ffffff" },
        { position: 0.15, color: "#87CEEB" },
        { position: 0.2, color: "#00BFFF" },
        { position: 0.4, color: "#228B22" },
        { position: 0.6, color: "#32CD32" },
        { position: 0.8, color: "#8B4513" },
        { position: 1, color: "#654321" }
      ]
    },
    spooky: {
      numBoids: 200,
      perceptionRadius: 40,
      maxSpeed: 3,
      maxForce: 0.2,
      bounceEdges: true,
      delaunayMode: true,
      showPerceptionRadius: false,
      speedColorMode: false,
      showObjects: false,
      gravityEnabled: false,
      gradientKeys: [
        { position: 0, color: "#000000" },
        { position: 0.2, color: "#2E0854" },
        { position: 0.4, color: "#4B0082" },
        { position: 0.6, color: "#8B0000" },
        { position: 0.8, color: "#FF4500" },
        { position: 1, color: "#FF6347" }
      ]
    },
    serene: {
      numBoids: 150,
      perceptionRadius: 80,
      maxSpeed: 1,
      maxForce: 0.1,
      bounceEdges: false,
      delaunayMode: true,
      showPerceptionRadius: false,
      speedColorMode: true,
      showObjects: false,
      gravityEnabled: false,
      gradientKeys: [
        { position: 0, color: "#ADD8E6" },
        { position: 0.5, color: "#FFFFFF" },
        { position: 1, color: "#87CEFA" }
      ]
    },
    indie: {
      numBoids: 250,
      perceptionRadius: 50,
      maxSpeed: 4,
      maxForce: 0.01,
      bounceEdges: true,
      delaunayMode: true,
      showPerceptionRadius: false,
      speedColorMode: true,
      showObjects: false,
      gravityEnabled: false,
      gradientKeys: [
        { position: 0, color: "#a80874" },
        { position: 0.2, color: "#b7fdfe" },
        { position: 0.5, color: "#5ef38c" },
        { position: 0.7, color: "#2b9720" },
        { position: 1, color: "#343a1a" }
      ]
    },
    dune: {
      numBoids: 400,
      perceptionRadius: 60,
      maxSpeed: 5,
      maxForce: 0.15,
      bounceEdges: true,
      delaunayMode: true,
      showPerceptionRadius: false,
      speedColorMode: false,
      showObjects: false,
      gravityEnabled: false,
      gradientKeys: [
        { position: 0, color: "#443742" }, // Black
        { position: 0.3, color: "#846c5b" }, // Sea green
        { position: 0.4, color: "#cea07e" }, // Covenant purple
        { position: 0.7, color: "#edd9a3" }, // Lime green
        { position: 0.75, color: "#e2e8c0" }, // Sky blue
        { position: 0.9, color: "#e2e8c0" }, // Light blue
        { position: 1, color: "#000000" } // White
      ]
    },
    hell: {
      numBoids: 15,
      perceptionRadius: 30,
      maxSpeed: 6,
      maxForce: 0.25,
      bounceEdges: true,
      delaunayMode: true,
      showPerceptionRadius: false,
      speedColorMode: false,
      showObjects: false,
      gravityEnabled: false,
      gradientKeys: [
        { position: 0, color: "#8B0000" },
        { position: 0.5, color: "#FF4500" },
        { position: 1, color: "#FFD700" }
      ]
    },
    lemonade: {
      numBoids: 200,
      perceptionRadius: 60,
      maxSpeed: 3,
      maxForce: 0.2,
      bounceEdges: false,
      delaunayMode: true,
      showPerceptionRadius: true,
      speedColorMode: true,
      showObjects: false,
      gravityEnabled: false,
      gradientKeys: [
        { position: 0, color: "#FFFACD" },
        { position: 0.5, color: "#FFD700" },
        { position: 1, color: "#FF69B4" }
      ]
    },
    max: {
      numBoids: 2000, // Maximum number of boids
      perceptionRadius: 100, // Large perception radius
      maxSpeed: 20, // High speed
      maxForce: 0.5, // High steering force
      bounceEdges: false,
      delaunayMode: false,
      showPerceptionRadius: false,
      speedColorMode: true,
      showObjects: true,
      gravityEnabled: false,
      gradientKeys: [
        { position: 0, color: "#080708" }, // Bright red
        { position: 0.2, color: "#3772ff" }, // Bright green
        { position: 0.4, color: "#df2935" }, // Bright blue
        { position: 0.6, color: "#fdca40" }, // Bright yellow
        { position: 0.8, color: "#e6e8e6" }, // Bright magenta
        { position: 1, color: "#023c40" } // Bright cyan
      ]
    }
  };

  const config = presets[preset];
  if (!config) return;

  // Apply each preset value
  for (const [key, value] of Object.entries(config)) {
    if (key === 'gradientKeys') {
      CONFIG.gradientKeys = value; // Update gradient keys
      renderGradientKeys(); // Re-render the gradient keys UI
    } else {
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

  // Render trails if enabled
  if (CONFIG.showTrails) {
    renderTrails();
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

  // Initialize boids and their trails
  for (let i = 0; i < CONFIG.numBoids; i++) {
    boids.push(new Boid(Math.random() * canvas.width, Math.random() * canvas.height, i));
    boidTrails.push([]); // Initialize an empty trail for each boid
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

document.addEventListener('DOMContentLoaded', () => {
  renderGradientKeys();
});

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

function interpolateGradient(normalizedY, gradientKeys) {
  // Find the two gradient keys to interpolate between
  let lowerKey = gradientKeys[0];
  let upperKey = gradientKeys[gradientKeys.length - 1];

  for (let i = 0; i < gradientKeys.length - 1; i++) {
    if (normalizedY >= gradientKeys[i].position && normalizedY <= gradientKeys[i + 1].position) {
      lowerKey = gradientKeys[i];
      upperKey = gradientKeys[i + 1];
      break;
    }
  }

  // Calculate the interpolation factor
  const t = (normalizedY - lowerKey.position) / (upperKey.position - lowerKey.position);

  // Convert hex colors to RGBA
  const lowerColor = hexToRGBA(lowerKey.color);
  const upperColor = hexToRGBA(upperKey.color);

  // Interpolate between the two colors
  return [
    lowerColor[0] * (1 - t) + upperColor[0] * t, // Red
    lowerColor[1] * (1 - t) + upperColor[1] * t, // Green
    lowerColor[2] * (1 - t) + upperColor[2] * t, // Blue
    lowerColor[3] * (1 - t) + upperColor[3] * t  // Alpha
  ];
}

function renderGradientKeys() {
  const gradientKeyList = document.getElementById('gradientKeyList');
  gradientKeyList.innerHTML = ''; // Clear the list

  CONFIG.gradientKeys.forEach((key, index) => {
    const keyDiv = document.createElement('div');
    keyDiv.className = 'gradient-key';

    keyDiv.innerHTML = `
      <label>
        Color:
        <input type="color" value="${key.color}" onchange="updateGradientKey(${index}, 'color', this.value)">
      </label>
      <label>
        Position:
        <input type="range" min="0" max="1" step="0.01" value="${key.position}" onchange="updateGradientKey(${index}, 'position', this.value)">
        <span>${key.position}</span>
      </label>
      <button onclick="removeGradientKey(${index})">Remove</button>
    `;

    gradientKeyList.appendChild(keyDiv);
  });
}

function updateGradientKey(index, property, value) {
  if (property === 'position') {
    CONFIG.gradientKeys[index].position = parseFloat(value);
  } else if (property === 'color') {
    CONFIG.gradientKeys[index].color = value;
  }

  // Re-render the gradient keys to reflect changes
  renderGradientKeys();
}

function addGradientKey() {
  CONFIG.gradientKeys.push({ position: 0.5, color: '#ffffff' }); // Default values
  renderGradientKeys();
}

function removeGradientKey(index) {
  CONFIG.gradientKeys.splice(index, 1); // Remove the key at the specified index
  renderGradientKeys();
}

function renderTrails() {
  const trailVertices = [];
  const trailColors = [];

  for (let i = 0; i < boids.length; i++) {
    const trail = boidTrails[i];
    for (const point of trail) {
      const [x, y] = toNDC(point.position[0], point.position[1]); // Convert to NDC
      trailVertices.push(x, y);
      trailColors.push(...point.color); // Use the color stored at that position
    }
  }

  // Pass trail vertices to WebGL
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(trailVertices), gl.STATIC_DRAW);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPosition);

  // Pass trail colors to WebGL
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(trailColors), gl.STATIC_DRAW);
  gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aColor);

  // Draw the trails as points
  gl.drawArrays(gl.POINTS, 0, trailVertices.length / 2);
}