import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// ============================================================
// MOBILE DETECTION & LOADING SCREEN HELPERS
// ============================================================

const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const loadingBar = document.getElementById("loading-bar");
const loadingText = document.getElementById("loading-text");
const loadingScreen = document.getElementById("loading-screen");

function hideLoadingScreen() {
  if (loadingScreen && loadingScreen.style.display !== "none") {
    loadingScreen.style.opacity = "0";
    setTimeout(() => {
      loadingScreen.style.display = "none";
    }, 500);
  }
}

// Loading Progress Tracker
const loadingManager = new THREE.LoadingManager();

loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
  const progress = Math.round((itemsLoaded / itemsTotal) * 100);
  if (loadingBar) loadingBar.style.width = `${progress}%`;
  if (loadingText) loadingText.textContent = `Loading textures... ${progress}%`;
};

loadingManager.onLoad = () => {
  hideLoadingScreen();
};

// FAILSAFE: Force-hide loading screen after 4 seconds even if a network request hangs
setTimeout(() => {
  hideLoadingScreen();
}, 4000);

// ============================================================
// SETTINGS
// ============================================================

const CONFIG = {
  orbitalRate: 0.07,
  rotationRate: 1,
  exposure: 1,
  backgroundIntensity: 0.22,
  atmosphereRims: true,
  maxPixelRatio: IS_MOBILE ? 1 : 2,
};

const FILES = {
  sun: "2k_sun.jpg",
  mercury: "2k_mercury.jpg",
  venusSurface: "2k_venus_surface.jpg",
  venusClouds: "2k_venus_atmosphere.jpg",
  earth: "2k_earth_daymap.jpg",
  earthClouds: "2k_earth_clouds.jpg",
  earthNight: "2k_earth_nightmap.jpg",
  moon: "2k_moon.jpg",
  mars: "2k_mars.jpg",
  jupiter: "2k_jupiter.jpg",
  saturn: "2k_saturn.jpg",
  saturnRings: "2k_saturn_ring_alpha.png",
  uranus: "2k_uranus.jpg",
  neptune: "2k_neptune.jpg",
  background: "2k_stars_milky_way.jpg",
};

// ============================================================
// RENDERER / CAMERA
// ============================================================

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});

renderer.setPixelRatio(
  Math.min(window.devicePixelRatio, CONFIG.maxPixelRatio)
);

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = CONFIG.exposure;

document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.01,
  2000
);

const overviewPosition = new THREE.Vector3(0, 57, 100);
camera.position.copy(overviewPosition);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 0.2;
controls.maxDistance = 220;
controls.target.set(0, 0, 0);
controls.update();

// ============================================================
// POST-PROCESSING: BLOOM
// ============================================================

const composer = new EffectComposer(renderer);

const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  IS_MOBILE ? 0.15 : 0.3,
  0.35,
  1.0
);

composer.addPass(bloomPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

// ============================================================
// TEXTURES
// ============================================================

const textureLoader = new THREE.TextureLoader(loadingManager);

const anisotropy = Math.min(
  8,
  renderer.capabilities.getMaxAnisotropy()
);

async function loadTexture(
  filename,
  { color = true, spherical = true } = {}
) {
  try {
    const texture = await textureLoader.loadAsync(
      `/textures/${filename}`
    );

    texture.colorSpace = color
      ? THREE.SRGBColorSpace
      : THREE.NoColorSpace;

    texture.wrapS = spherical
      ? THREE.RepeatWrapping
      : THREE.ClampToEdgeWrapping;

    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = anisotropy;

    return texture;
  } catch (error) {
    console.warn(
      `Missing image: /textures/${filename}`,
      error
    );

    return null;
  }
}

async function loadAssets() {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([key, filename]) => {
      const texture = await loadTexture(filename, {
        color: key !== "earthClouds",
        spherical: key !== "saturnRings",
      });

      return [key, texture];
    })
  );

  return Object.fromEntries(entries);
}

// ============================================================
// HELPERS
// ============================================================

const sphereGeometry = new THREE.SphereGeometry(
  1,
  IS_MOBILE ? 48 : 96,
  IS_MOBILE ? 32 : 64
);

function makeSphere(radius, material) {
  const mesh = new THREE.Mesh(sphereGeometry, material);
  mesh.scale.setScalar(radius);
  return mesh;
}

function makeSurfaceMaterial(texture, fallbackColor) {
  return new THREE.MeshStandardMaterial({
    map: texture || null,
    color: texture ? 0xffffff : fallbackColor,
    roughness: 1,
    metalness: 0,
  });
}

function addWorldVaryings(shader) {
  const declarations = `
    varying vec3 vSurfaceWorldPosition;
    varying vec3 vSurfaceWorldNormal;
  `;

  shader.vertexShader = shader.vertexShader.replace(
    "#include <common>",
    `#include <common>
     ${declarations}`
  );

  shader.vertexShader = shader.vertexShader.replace(
    "#include <project_vertex>",
    `
      #include <project_vertex>

      vSurfaceWorldPosition =
        (modelMatrix * vec4(transformed, 1.0)).xyz;

      vSurfaceWorldNormal = inverseTransformDirection(
        transformedNormal,
        viewMatrix
      );
    `
  );

  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <common>",
    `#include <common>
     ${declarations}`
  );
}

// ============================================================
// EARTH NIGHT LIGHTS
// ============================================================

function enableNightLights(material, texture) {
  if (!texture) return;

  material.emissive.set(0xffffff);
  material.emissiveMap = texture;
  material.emissiveIntensity = 1.15;

  material.onBeforeCompile = (shader) => {
    addWorldVaryings(shader);

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `
        #include <emissivemap_fragment>

        vec3 directionToSun =
          normalize(-vSurfaceWorldPosition);

        float solarCosine = dot(
          normalize(vSurfaceWorldNormal),
          directionToSun
        );

        float nightMask =
          1.0 - smoothstep(-0.12, 0.04, solarCosine);

        totalEmissiveRadiance *= nightMask;
      `
    );
  };

  material.customProgramCacheKey = () => "earth-night-v2";
}

// ============================================================
// ATMOSPHERE RIM
// ============================================================

function makeAtmosphere(radius, color, strength) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: strength },
    },

    vertexShader: `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      void main() {
        vec4 worldPosition =
          modelMatrix * vec4(position, 1.0);

        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);

        gl_Position =
          projectionMatrix * viewMatrix * worldPosition;
      }
    `,

    fragmentShader: `
      uniform vec3 uColor;
      uniform float uStrength;

      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPosition);
        vec3 L = normalize(-vWorldPosition);

        float rim = pow(
          1.0 - clamp(dot(N, V), 0.0, 1.0),
          4.0
        );

        float illumination = smoothstep(
          -0.04,
          0.3,
          dot(N, L)
        );

        float alpha = rim * illumination * uStrength;

        gl_FragColor = vec4(uColor, alpha);

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,

    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  return makeSphere(radius, material);
}

// ============================================================
// PLANET DATA
// ============================================================

const DEFINITIONS = [
  {
    name: "Mercury",
    texture: "mercury",
    radius: 0.28,
    distance: 6,
    period: 0.241,
    tilt: 0.03,
    spin: 0.006,
    fallback: 0x8a8278,
  },
  {
    name: "Venus",
    texture: "venusSurface",
    radius: 0.7,
    distance: 8.5,
    period: 0.615,
    tilt: 177.4,
    spin: 0.002,
    fallback: 0xb5966c,
  },
  {
    name: "Earth",
    texture: "earth",
    radius: 0.74,
    distance: 11.5,
    period: 1,
    tilt: 23.44,
    spin: 0.12,
    fallback: 0x426a8b,
  },
  {
    name: "Mars",
    texture: "mars",
    radius: 0.4,
    distance: 15,
    period: 1.881,
    tilt: 25.19,
    spin: 0.116,
    fallback: 0xa36c50,
  },
  {
    name: "Jupiter",
    texture: "jupiter",
    radius: 2.25,
    distance: 22,
    period: 11.86,
    tilt: 3.13,
    spin: 0.29,
    fallback: 0xc2ab92,
  },
  {
    name: "Saturn",
    texture: "saturn",
    radius: 1.9,
    distance: 31,
    period: 29.45,
    tilt: 26.73,
    spin: 0.27,
    fallback: 0xd4c6a4,
  },
  {
    name: "Uranus",
    texture: "uranus",
    radius: 1.2,
    distance: 40,
    period: 84.02,
    tilt: 97.77,
    spin: 0.17,
    fallback: 0xa7cbd0,
  },
  {
    name: "Neptune",
    texture: "neptune",
    radius: 1.16,
    distance: 48,
    period: 164.8,
    tilt: 28.32,
    spin: 0.18,
    fallback: 0x789eaf,
  },
];

// ============================================================
// STATE
// ============================================================

const planets = [];
const bodies = new Map();
const pickableMeshes = [];

let sun = null;
let earthClouds = null;
let venusClouds = null;
let venusAtmosphere = null;
let moon = null;

let simulationTime = 0;
let paused = false;
let ready = false;
let followedBody = null;

const lastFollowPosition = new THREE.Vector3();
const currentFollowPosition = new THREE.Vector3();
const followDelta = new THREE.Vector3();

// ============================================================
// CAMERA TRANSITION STATE
// ============================================================

let cameraTransition = null;
const transitionDestination = new THREE.Vector3();

controls.addEventListener("start", () => {
  cameraTransition = null;
});

// ============================================================
// SUN
// ============================================================

function createSun(texture) {
  const material = new THREE.MeshBasicMaterial({
    map: texture || null,
    color: texture ? 0xffffff : 0xffe5b0,
  });

  material.color.multiplyScalar(3);
  sun = makeSphere(3.5, material);
  scene.add(sun);

  const body = {
    name: "Sun",
    root: sun,
    radius: 3.5,
    viewRadius: 3.5,
  };

  sun.userData.body = body;
  bodies.set("Sun", body);
  pickableMeshes.push(sun);

  const sunlight = new THREE.PointLight(0xffffff, 3, 0, 0);
  sunlight.position.set(0, 0, 0);
  scene.add(sunlight);
}

// ============================================================
// PLANETS
// ============================================================

function createPlanets(textures) {
  DEFINITIONS.forEach((definition, index) => {
    const root = new THREE.Group();
    scene.add(root);

    const axis = new THREE.Group();
    axis.rotation.z = THREE.MathUtils.degToRad(definition.tilt);
    root.add(axis);

    const material = makeSurfaceMaterial(
      textures[definition.texture],
      definition.fallback
    );

    if (definition.name === "Earth") {
      enableNightLights(material, textures.earthNight);
    }

    const mesh = makeSphere(definition.radius, material);
    axis.add(mesh);

    const planet = {
      ...definition,
      root,
      axis,
      mesh,
      phase: index * 0.78,
      viewRadius:
        definition.name === "Saturn"
          ? definition.radius * 2.33
          : definition.radius,
    };

    mesh.userData.body = planet;

    planets.push(planet);
    bodies.set(planet.name, planet);
    pickableMeshes.push(mesh);
  });
}

// ============================================================
// EARTH CLOUDS / ATMOSPHERE
// ============================================================

function createEarthLayers(textures) {
  const earth = bodies.get("Earth");

  if (textures.earthClouds) {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      alphaMap: textures.earthClouds,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      roughness: 1,
      metalness: 0,
    });

    earthClouds = makeSphere(earth.radius * 1.002, material);
    earth.axis.add(earthClouds);

    earthClouds.userData.body = earth;
    pickableMeshes.push(earthClouds);
  }

  if (CONFIG.atmosphereRims) {
    earth.axis.add(
      makeAtmosphere(earth.radius * 1.012, 0x79aaff, 0.22)
    );
  }
}

// ============================================================
// VENUS CLOUDS
// ============================================================

function createVenusLayers(textures) {
  const venus = bodies.get("Venus");

  const material = makeSurfaceMaterial(
    textures.venusClouds,
    0xd8cfb8
  );

  venusClouds = makeSphere(venus.radius * 1.01, material);
  venus.axis.add(venusClouds);

  venusClouds.userData.body = venus;
  pickableMeshes.push(venusClouds);

  if (CONFIG.atmosphereRims) {
    venusAtmosphere = makeAtmosphere(
      venus.radius * 1.022,
      0xe5d7b7,
      0.12
    );

    venus.axis.add(venusAtmosphere);
  }
}

// ============================================================
// MOON
// ============================================================

function createMoon(textures) {
  const earth = bodies.get("Earth");

  const orbit = new THREE.Group();
  orbit.rotation.x = THREE.MathUtils.degToRad(5.145);
  earth.root.add(orbit);

  moon = makeSphere(
    0.2,
    makeSurfaceMaterial(textures.moon, 0x858585)
  );

  orbit.add(moon);

  const body = {
    name: "Moon",
    root: moon,
    radius: 0.2,
    viewRadius: 0.2,
  };

  moon.userData.body = body;
  bodies.set("Moon", body);
  pickableMeshes.push(moon);
}

// ============================================================
// MARS ATMOSPHERE
// ============================================================

function createMarsAtmosphere() {
  if (!CONFIG.atmosphereRims) return;

  const mars = bodies.get("Mars");

  mars.axis.add(
    makeAtmosphere(mars.radius * 1.015, 0xc8a18a, 0.075)
  );
}

// ============================================================
// SATURN RINGS
// ============================================================

function createSaturnRings(texture) {
  if (!texture) return;

  const saturn = bodies.get("Saturn");

  const innerRadius = saturn.radius * 1.24;
  const outerRadius = saturn.radius * 2.33;

  const geometry = new THREE.RingGeometry(
    innerRadius,
    outerRadius,
    256,
    8
  );

  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;

  for (let i = 0; i < positions.count; i++) {
    const radius = Math.hypot(
      positions.getX(i),
      positions.getY(i)
    );

    const u = THREE.MathUtils.clamp(
      (radius - innerRadius) / (outerRadius - innerRadius),
      0,
      1
    );

    uvs.setXY(i, u, 0.5);
  }

  uvs.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    alphaTest: 0.005,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  });

  material.onBeforeCompile = (shader) => {
    addWorldVaryings(shader);

    shader.uniforms.uPlanetCenter = {
      value: saturn.root.position,
    };

    shader.uniforms.uPlanetRadius = {
      value: saturn.radius,
    };

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `
        #include <common>

        uniform vec3 uPlanetCenter;
        uniform float uPlanetRadius;
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_fragment_end>",
      `
        #include <lights_fragment_end>

        vec3 ringToSun = normalize(-vSurfaceWorldPosition);

        vec3 ringToPlanet =
          uPlanetCenter - vSurfaceWorldPosition;

        float alongRay = dot(ringToPlanet, ringToSun);

        float perpendicularDistance = length(
          ringToPlanet - ringToSun * alongRay
        );

        float ringSunVisibility = 1.0;

        if (
          alongRay > 0.0 &&
          alongRay < length(vSurfaceWorldPosition)
        ) {
          ringSunVisibility = smoothstep(
            uPlanetRadius * 0.995,
            uPlanetRadius * 1.005,
            perpendicularDistance
          );
        }

        reflectedLight.directDiffuse *= ringSunVisibility;
        reflectedLight.directSpecular *= ringSunVisibility;
      `
    );
  };

  material.customProgramCacheKey = () => "saturn-ring-shadow-v2";

  const rings = new THREE.Mesh(geometry, material);
  rings.rotation.x = -Math.PI / 2;
  saturn.axis.add(rings);

  rings.userData.body = saturn;
  pickableMeshes.push(rings);
}

// ============================================================
// MILKY WAY
// ============================================================

function createBackground(texture) {
  if (!texture) return;

  texture.mapping = THREE.EquirectangularReflectionMapping;

  scene.background = texture;
  scene.backgroundIntensity = CONFIG.backgroundIntensity;

  scene.backgroundRotation.set(
    THREE.MathUtils.degToRad(60),
    0,
    0
  );
}

// ============================================================
// ANIMATION
// ============================================================

function updateBodies(delta) {
  simulationTime += delta;

  for (const planet of planets) {
    const angle =
      planet.phase +
      (simulationTime * CONFIG.orbitalRate) / planet.period;

    planet.root.position.set(
      Math.cos(angle) * planet.distance,
      0,
      -Math.sin(angle) * planet.distance
    );

    planet.mesh.rotation.y +=
      delta * planet.spin * CONFIG.rotationRate;
  }

  if (sun) {
    sun.rotation.y += delta * 0.01;
  }

  if (earthClouds) {
    const earth = bodies.get("Earth");

    earthClouds.rotation.y +=
      delta * earth.spin * CONFIG.rotationRate * 1.015;
  }

  if (venusClouds) {
    venusClouds.rotation.y +=
      delta * 0.03 * CONFIG.rotationRate;
  }

  if (moon) {
    const angle =
      simulationTime * CONFIG.orbitalRate * 13.37;

    moon.position.set(
      Math.cos(angle) * 1.65,
      0,
      -Math.sin(angle) * 1.65
    );

    moon.rotation.y = angle;
  }
}

// ============================================================
// CAMERA FOCUS
// ============================================================

function focusBody(name) {
  const body = bodies.get(name);
  if (!body) return;

  scene.updateMatrixWorld(true);

  const center = body.root.getWorldPosition(
    new THREE.Vector3()
  );

  const direction = camera.position
    .clone()
    .sub(controls.target);

  if (direction.lengthSq() < 0.0001) {
    direction.set(0, 0.35, 1);
  }

  direction.normalize();

  const distance = Math.max(
    body.viewRadius * 5,
    1
  );

  cameraTransition = {
    elapsed: 0,
    duration: 1.6,

    startPosition: camera.position.clone(),
    startTarget: controls.target.clone(),

    endOffset: direction.multiplyScalar(distance),
  };

  followedBody = body;
  lastFollowPosition.copy(center);

  controls.minDistance = 0.05;
}

function showOverview() {
  followedBody = null;

  cameraTransition = {
    elapsed: 0,
    duration: 1.8,

    startPosition: camera.position.clone(),
    startTarget: controls.target.clone(),

    endPosition: overviewPosition.clone(),
    endTarget: new THREE.Vector3(0, 0, 0),
  };

  controls.minDistance = 0.05;
}

function updateCameraFollow(delta) {
  if (followedBody) {
    followedBody.root.getWorldPosition(
      currentFollowPosition
    );

    followDelta.subVectors(
      currentFollowPosition,
      lastFollowPosition
    );

    camera.position.add(followDelta);
    controls.target.add(followDelta);

    if (cameraTransition) {
      cameraTransition.startPosition.add(followDelta);
      cameraTransition.startTarget.add(followDelta);
    }

    lastFollowPosition.copy(currentFollowPosition);
  }

  if (!cameraTransition) return;

  const transition = cameraTransition;

  transition.elapsed += delta;

  const progress = Math.min(
    transition.elapsed / transition.duration,
    1
  );

  const eased =
    progress * progress * (3 - 2 * progress);

  if (followedBody) {
    transitionDestination
      .copy(currentFollowPosition)
      .add(transition.endOffset);

    camera.position.lerpVectors(
      transition.startPosition,
      transitionDestination,
      eased
    );

    controls.target.lerpVectors(
      transition.startTarget,
      currentFollowPosition,
      eased
    );
  } else {
    camera.position.lerpVectors(
      transition.startPosition,
      transition.endPosition,
      eased
    );

    controls.target.lerpVectors(
      transition.startTarget,
      transition.endTarget,
      eased
    );
  }

  if (progress >= 1) {
    cameraTransition = null;

    controls.minDistance = followedBody
      ? followedBody.viewRadius * 1.25
      : 0.2;
  }
}

// ============================================================
// CLICK A BODY TO SHOW DETAILS
// ============================================================

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

let clickStart = null;

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !event.isPrimary) return;

  clickStart = {
    x: event.clientX,
    y: event.clientY,
    id: event.pointerId,
    moved: false,
  };
});

renderer.domElement.addEventListener("pointermove", (event) => {
  if (!clickStart || event.pointerId !== clickStart.id) return;

  if (
    Math.hypot(
      event.clientX - clickStart.x,
      event.clientY - clickStart.y
    ) > 6
  ) {
    clickStart.moved = true;
  }
});

renderer.domElement.addEventListener("pointercancel", () => {
  clickStart = null;
});

renderer.domElement.addEventListener("pointerup", (event) => {
  if (!clickStart || event.pointerId !== clickStart.id) return;

  const start = clickStart;
  clickStart = null;

  if (!ready || event.button !== 0 || start.moved) return;

  const movement = Math.hypot(
    event.clientX - start.x,
    event.clientY - start.y
  );

  if (movement > 6) return;

  const rect = renderer.domElement.getBoundingClientRect();

  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);

  raycaster.setFromCamera(pointer, camera);

  const selectableMeshes = pickableMeshes.filter(
    (mesh) =>
      mesh.visible &&
      mesh.geometry.type !== "RingGeometry"
  );

  const hits = raycaster.intersectObjects(
    selectableMeshes,
    false
  );

  if (hits.length === 0) return;

  const body = hits[0].object.userData.body;
  if (!body) return;

  focusBody(body.name);
  showBodyInfo(body.name);
});

// ============================================================
// KEYBOARD
// ============================================================

const focusKeys = {
  "0": "Sun",
  "1": "Mercury",
  "2": "Venus",
  "3": "Earth",
  "4": "Mars",
  "5": "Jupiter",
  "6": "Saturn",
  "7": "Uranus",
  "8": "Neptune",
  "9": "Moon",
};

window.addEventListener("keydown", (event) => {
  if (!ready || event.repeat) return;

  const key = event.key.toLowerCase();

  if (focusKeys[key]) {
    focusBody(focusKeys[key]);
    showBodyInfo(focusKeys[key]);
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    paused = !paused;
  }

  if (key === "h" || key === "home") {
    event.preventDefault();
    showOverview();
  }

  if (key === "v" && venusClouds) {
    venusClouds.visible = !venusClouds.visible;

    if (venusAtmosphere) {
      venusAtmosphere.visible = venusClouds.visible;
    }
  }
});

// ============================================================
// WINDOW RESIZE
// ============================================================

window.addEventListener("resize", () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  const pixelRatio = Math.min(
    window.devicePixelRatio,
    CONFIG.maxPixelRatio
  );

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height);

  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);
});

// ============================================================
// RENDER LOOP
// ============================================================

let previousTime;

function animate(milliseconds) {
  const seconds = milliseconds / 1000;

  const delta =
    previousTime === undefined
      ? 0
      : Math.min(seconds - previousTime, 0.05);

  previousTime = seconds;

  if (!paused) {
    updateBodies(delta);
  }

  scene.updateMatrixWorld(true);

  updateCameraFollow(delta);

  controls.update();

  composer.render();
}

// ============================================================
// PLANETARY INTERIORS DATA
// ============================================================

const INTERIORS = {
  Sun: {
    note:
      "The Sun is plasma, not a solid body. Boundaries shown are approximate. " +
      "The photosphere is exaggerated in thickness for visibility.",
    layers: [
      {
        name: "Photosphere",
        radius: 1,
        color: "#ead7a0",
        text: "The thin visible layer from which most sunlight escapes.",
      },
      {
        name: "Convection zone",
        radius: 0.98,
        color: "#caa76c",
        text: "Energy is transported largely by the motion of plasma.",
      },
      {
        name: "Radiative zone",
        radius: 0.71,
        color: "#b78058",
        text: "Energy moves outward mainly through radiative transfer.",
      },
      {
        name: "Core",
        radius: 0.25,
        color: "#eee2c3",
        text: "Hydrogen fusion supplies the Sun's energy.",
      },
    ],
  },

  Mercury: {
    note:
      "Mercury has an unusually large metallic core. " +
      "The size and properties of its solid inner core remain uncertain.",
    layers: [
      {
        name: "Crust",
        radius: 1,
        color: "#99918a",
        text: "A thin rocky outer layer; exaggerated here.",
      },
      {
        name: "Silicate mantle",
        radius: 0.94,
        color: "#9a785f",
        text: "Rocky material surrounding the large metallic core.",
      },
      {
        name: "Metallic core",
        radius: 0.8,
        color: "#c3a16b",
        text: "An iron-rich core with a liquid portion; a solid inner core may also be present.",
      },
    ],
  },

  Venus: {
    note:
      "Venus's internal boundaries and core state are poorly constrained. " +
      "The displayed proportions are illustrative.",
    layers: [
      {
        name: "Crust",
        radius: 1,
        color: "#a18a72",
        text: "Rocky outer shell with extensive volcanic terrain.",
      },
      {
        name: "Silicate mantle",
        radius: 0.94,
        color: "#a87956",
        text: "A thick rocky mantle, expected to transfer heat through convection.",
      },
      {
        name: "Metallic core",
        radius: 0.53,
        color: "#bea16e",
        text: "Likely iron-rich. Its size and liquid/solid structure remain uncertain.",
      },
    ],
  },

  Earth: {
    note:
      "Core boundaries are shown at approximate radius fractions. " +
      "The thin, geographically variable crust is enlarged for visibility.",
    layers: [
      {
        name: "Crust",
        radius: 1,
        color: "#9b8a70",
        text: "Solid rock, roughly 5–70 km thick depending on location.",
      },
      {
        name: "Mantle",
        radius: 0.98,
        color: "#ab7851",
        text: "Mostly solid silicate rock that deforms and convects over geological time.",
      },
      {
        name: "Outer core",
        radius: 0.546,
        color: "#c2a064",
        text: "Liquid iron-rich alloy. Its motion helps generate Earth's magnetic field.",
      },
      {
        name: "Inner core",
        radius: 0.192,
        color: "#ddd0ac",
        text: "Solid iron-rich alloy held solid by immense pressure.",
      },
    ],
  },

  Moon: {
    note:
      "Lunar structure is inferred from seismic, gravity, and rotational data. " +
      "A partially molten region near the core is omitted from this simplified view.",
    layers: [
      {
        name: "Crust",
        radius: 1,
        color: "#aaa49b",
        text: "An ancient rocky crust, thicker on average on the far side.",
      },
      {
        name: "Mantle",
        radius: 0.95,
        color: "#8c7565",
        text: "Mostly solid silicate rock.",
      },
      {
        name: "Fluid outer core",
        radius: 0.2,
        color: "#b09668",
        text: "A small iron-rich fluid region, with uncertain dimensions.",
      },
      {
        name: "Solid inner core",
        radius: 0.14,
        color: "#c5b997",
        text: "Evidence supports a small solid inner core.",
      },
    ],
  },

  Mars: {
    note:
      "Mars's deep interior remains an active research area. " +
      "Some seismic models include a molten silicate layer above the core.",
    layers: [
      {
        name: "Crust",
        radius: 1,
        color: "#ac8973",
        text: "A rocky crust of variable thickness, enlarged here.",
      },
      {
        name: "Mantle",
        radius: 0.94,
        color: "#987051",
        text: "Predominantly solid silicate rock.",
      },
      {
        name: "Liquid metallic core",
        radius: 0.52,
        color: "#b49a68",
        text: "Iron-rich liquid containing lighter elements. Its exact size is model-dependent.",
      },
    ],
  },

  Jupiter: {
    note:
      "These are gradual pressure-dependent regions, not solid shells. " +
      "The dilute core's extent and composition are model-dependent.",
    layers: [
      {
        name: "Cloud-bearing atmosphere",
        radius: 1,
        color: "#c6b59b",
        text: "The visible atmosphere; there is no solid surface below the clouds.",
      },
      {
        name: "Molecular hydrogen envelope",
        radius: 0.94,
        color: "#b39b7b",
        text: "Hydrogen and helium become increasingly dense with depth.",
      },
      {
        name: "Metallic hydrogen region",
        radius: 0.76,
        color: "#8e999c",
        text: "At high pressure, hydrogen becomes electrically conducting.",
      },
      {
        name: "Dilute core region",
        radius: 0.4,
        color: "#8c8178",
        text: "A central region enriched in heavier elements and mixed with hydrogen and helium.",
      },
    ],
  },

  Saturn: {
    note:
      "Boundaries are schematic. Saturn likely has an extended, " +
      "compositionally graded interior rather than a compact sharply bounded core.",
    layers: [
      {
        name: "Cloud-bearing atmosphere",
        radius: 1,
        color: "#d0c4a5",
        text: "A hydrogen-rich atmosphere with pale cloud bands.",
      },
      {
        name: "Molecular hydrogen envelope",
        radius: 0.94,
        color: "#b9a785",
        text: "Hydrogen and helium grow denser with increasing pressure.",
      },
      {
        name: "Metallic hydrogen region",
        radius: 0.6,
        color: "#96a0a0",
        text: "Electrically conducting hydrogen; helium separation also affects the interior.",
      },
      {
        name: "Diffuse core region",
        radius: 0.42,
        color: "#8d8272",
        text: "An extended region enriched in heavier elements.",
      },
    ],
  },

  Uranus: {
    note:
      "Uranus's interior is poorly constrained. This is a traditional simplified model. " +
      "'Ice giant' does not mean a planet containing ordinary solid ice layers.",
    layers: [
      {
        name: "Atmosphere",
        radius: 1,
        color: "#b1cdca",
        text: "Hydrogen, helium, and methane contribute to the visible atmosphere.",
      },
      {
        name: "Outer envelope",
        radius: 0.93,
        color: "#829da0",
        text: "A deeper hydrogen/helium-rich region.",
      },
      {
        name: "Heavy-element-rich interior",
        radius: 0.78,
        color: "#71878c",
        text: "Hot, high-pressure mixtures possibly including water, ammonia, methane, and rock.",
      },
      {
        name: "Central rocky region",
        radius: 0.25,
        color: "#8a8174",
        text: "A possible rocky central concentration; size and distinctness are uncertain.",
      },
    ],
  },

  Neptune: {
    note:
      "Neptune's interior is model-dependent. Regions may be mixed and gradual, " +
      "rather than separated into the clean shells shown here.",
    layers: [
      {
        name: "Atmosphere",
        radius: 1,
        color: "#9dbbc9",
        text: "Hydrogen, helium, and methane, with changing clouds and storms.",
      },
      {
        name: "Outer envelope",
        radius: 0.93,
        color: "#8298ac",
        text: "A dense hydrogen/helium-rich region.",
      },
      {
        name: "Heavy-element-rich interior",
        radius: 0.76,
        color: "#727e96",
        text: "Hot, compressed mixtures of volatile compounds and rocky material.",
      },
      {
        name: "Central rocky region",
        radius: 0.27,
        color: "#898075",
        text: "A possible central concentration of rock and metal; its boundary is uncertain.",
      },
    ],
  },
};

// ============================================================
// STRUCTURE VIEWER LAYOUT
// ============================================================

const structureStyle = document.createElement("style");

structureStyle.textContent = `
  .structure-open-button {
    width: 100%;
    padding: 11px 14px;
    border: 1px solid #667d95;
    border-radius: 7px;
    background: #26384b;
    color: white;
    font: inherit;
    cursor: pointer;
  }

  .structure-open-button:hover {
    background: #344b63;
  }

  #structure-dialog {
    width: min(1080px, calc(100vw - 32px));
    max-width: none;
    max-height: calc(100dvh - 32px);
    padding: 0;
    box-sizing: border-box;
    border: 1px solid #465365;
    border-radius: 12px;
    background: #0a0e15;
    color: #edf2f7;
    font: 14px/1.6 system-ui, sans-serif;
  }

  #structure-dialog::backdrop {
    background: rgba(0, 0, 0, 0.8);
  }

  .structure-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 16px 20px;
    border-bottom: 1px solid #293340;
  }

  .structure-header h2 {
    margin: 0;
    font-size: 22px;
  }

  .structure-close {
    border: 0;
    background: transparent;
    color: white;
    font-size: 28px;
    cursor: pointer;
  }

  .structure-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(260px, 1fr);
  }

  #structure-canvas-host {
    height: 480px;
    min-width: 0;
    overflow: hidden;
    background: #05080d;
  }

  #structure-canvas-host canvas {
    display: block;
    touch-action: none;
  }

  #structure-legend {
    padding: 20px;
    max-height: 480px;
    overflow-y: auto;
    box-sizing: border-box;
  }

  .structure-layer {
    border-left: 4px solid var(--layer-color);
    padding-left: 12px;
    margin: 18px 0;
  }

  .structure-layer h3 {
    font-size: 15px;
    margin: 0 0 4px;
  }

  .structure-layer p {
    color: #bec8d5;
    margin: 0;
  }

  .structure-note {
    color: #aab7c7;
    font-size: 12px;
  }

  @media (max-width: 720px) {
    .structure-layout {
      grid-template-columns: 1fr;
    }

    #structure-canvas-host {
      height: 320px;
    }

    #structure-legend {
      max-height: none;
    }
  }
`;

document.head.appendChild(structureStyle);

const structureDialog = document.createElement("dialog");
structureDialog.id = "structure-dialog";
structureDialog.setAttribute("aria-labelledby", "structure-title");

structureDialog.innerHTML = `
  <header class="structure-header">
    <h2 id="structure-title">Internal structure</h2>
    <button
      class="structure-close"
      type="button"
      aria-label="Close structure viewer"
    >×</button>
  </header>

  <div class="structure-layout">
    <div id="structure-canvas-host"></div>
    <section
      id="structure-legend"
      aria-label="Interior layers"
    ></section>
  </div>
`;

document.body.appendChild(structureDialog);

const structureTitle =
  structureDialog.querySelector("#structure-title");

const structureHost =
  structureDialog.querySelector("#structure-canvas-host");

const structureLegend =
  structureDialog.querySelector("#structure-legend");

const structureClose =
  structureDialog.querySelector(".structure-close");

// ============================================================
// SEPARATE 3D VIEWER
// ============================================================

let structureRenderer = null;
let structureScene = null;
let structureCamera = null;
let structureControls = null;
let structureModel = null;

let resumeMainSimulation = false;

function initializeStructureRenderer() {
  if (structureRenderer) return;

  structureRenderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
  });

  structureRenderer.setPixelRatio(
    Math.min(window.devicePixelRatio, 1.5)
  );

  structureRenderer.outputColorSpace = THREE.SRGBColorSpace;
  structureRenderer.toneMapping = THREE.NoToneMapping;

  structureHost.appendChild(structureRenderer.domElement);

  structureScene = new THREE.Scene();
  structureScene.background = new THREE.Color(0x05080d);

  structureCamera = new THREE.PerspectiveCamera(
    40,
    1,
    0.01,
    30
  );

  structureControls = new OrbitControls(
    structureCamera,
    structureRenderer.domElement
  );

  structureControls.enableDamping = true;
  structureControls.enablePan = false;
  structureControls.minDistance = 2.3;
  structureControls.maxDistance = 7;

  structureModel = new THREE.Group();
  structureScene.add(structureModel);
}

function resizeStructureViewer() {
  if (!structureRenderer || !structureDialog.open) return;

  const width = structureHost.clientWidth;
  const height = structureHost.clientHeight;

  if (!width || !height) return;

  structureRenderer.setSize(width, height);

  structureCamera.aspect = width / height;
  structureCamera.updateProjectionMatrix();
}

const structureResizeObserver = new ResizeObserver(() => {
  resizeStructureViewer();
});

structureResizeObserver.observe(structureHost);

function clearStructureModel() {
  if (!structureModel) return;

  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();

  structureModel.traverse((object) => {
    if (object.geometry) {
      geometries.add(object.geometry);
    }

    if (!object.material) return;

    const list = Array.isArray(object.material)
      ? object.material
      : [object.material];

    for (const material of list) {
      materials.add(material);

      for (const key of [
        "map",
        "bumpMap",
        "normalMap",
        "roughnessMap",
        "emissiveMap",
      ]) {
        const texture = material[key];

        if (texture?.userData.interiorGenerated) {
          textures.add(texture);
        }
      }
    }
  });

  structureModel.clear();

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

function getBodySurfaceTexture(name) {
  if (name === "Sun") {
    return sun?.material?.map || null;
  }

  if (name === "Moon") {
    return moon?.material?.map || null;
  }

  if (name === "Venus") {
    return venusClouds?.material?.map || null;
  }

  return bodies.get(name)?.mesh?.material?.map || null;
}

// ============================================================
// BUILD A CUTAWAY MODEL
// ============================================================

function buildStructureModel(name) {
  clearStructureModel();

  const data = INTERIORS[name];
  if (!data) return;

  if (!structureScene.getObjectByName("cutaway-lighting")) {
    const lights = new THREE.Group();
    lights.name = "cutaway-lighting";

    lights.add(
      new THREE.HemisphereLight(0xffffff, 0x45403b, 1.1)
    );

    const key = new THREE.DirectionalLight(0xffecd6, 2.4);
    key.position.set(-4, 5, 5);
    lights.add(key);

    const fill = new THREE.DirectionalLight(0xdce8ff, 0.65);
    fill.position.set(4, 1, 2);
    lights.add(fill);

    structureScene.add(lights);
  }

  structureRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  structureRenderer.toneMappingExposure = 1;

  const shellGeometry = new THREE.SphereGeometry(
    1,
    128,
    96,
    Math.PI / 2,
    Math.PI * 1.5
  );

  const shellUV = shellGeometry.attributes.uv;

  for (let i = 0; i < shellUV.count; i++) {
    shellUV.setX(i, 0.25 + shellUV.getX(i) * 0.75);
  }

  shellUV.needsUpdate = true;

  const surfaceMap = getBodySurfaceTexture(name);

  const shellMaterial = new THREE.MeshStandardMaterial({
    map: surfaceMap,
    color: surfaceMap ? 0xffffff : 0x8c8274,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  structureModel.add(
    new THREE.Mesh(shellGeometry, shellMaterial)
  );

  function makeLayerMaps(layer, layerIndex, rocky) {
    const size = 512;

    let seed = 8471 + layerIndex * 173;

    for (const character of name) {
      seed = (Math.imul(seed, 31) + character.charCodeAt(0)) >>> 0;
    }

    function random() {
      seed = (
        Math.imul(seed, 1664525) + 1013904223
      ) >>> 0;

      return seed / 4294967296;
    }

    const noiseCanvas = document.createElement("canvas");
    noiseCanvas.width = noiseCanvas.height = size;

    const noiseContext = noiseCanvas.getContext("2d");
    noiseContext.fillStyle = "#808080";
    noiseContext.fillRect(0, 0, size, size);

    for (const resolution of [8, 16, 32, 64, 128, 256]) {
      const octave = document.createElement("canvas");
      octave.width = octave.height = resolution;

      const context = octave.getContext("2d");
      const pixels = context.createImageData(
        resolution,
        resolution
      );

      for (let i = 0; i < pixels.data.length; i += 4) {
        const value = Math.floor(random() * 256);

        pixels.data[i] = value;
        pixels.data[i + 1] = value;
        pixels.data[i + 2] = value;
        pixels.data[i + 3] = 255;
      }

      context.putImageData(pixels, 0, 0);

      noiseContext.globalAlpha =
        resolution <= 32 ? 0.48 : rocky ? 0.3 : 0.08;

      noiseContext.drawImage(octave, 0, 0, size, size);
    }

    noiseContext.globalAlpha = 1;

    const noise = noiseContext.getImageData(0, 0, size, size);

    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = colorCanvas.height = size;

    const colorContext = colorCanvas.getContext("2d");
    const colorPixels = colorContext.createImageData(size, size);

    const heightCanvas = document.createElement("canvas");
    heightCanvas.width = heightCanvas.height = size;

    const heightContext = heightCanvas.getContext("2d");
    const heightPixels = heightContext.createImageData(size, size);

    const hex = layer.color.replace("#", "");
    const base = [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];

    for (let i = 0; i < noise.data.length; i += 4) {
      const value = noise.data[i] / 255;

      const detail = THREE.MathUtils.clamp(
        (value - 0.5) * (rocky ? 3.8 : 2.0) + 0.5,
        0,
        1
      );

      const brightness = rocky
        ? 0.42 + detail * 0.9
        : 0.72 + detail * 0.45;

      for (let channel = 0; channel < 3; channel++) {
        colorPixels.data[i + channel] =
          Math.min(255, base[channel] * brightness);

        heightPixels.data[i + channel] = detail * 255;
      }

      colorPixels.data[i + 3] = 255;
      heightPixels.data[i + 3] = 255;
    }

    colorContext.putImageData(colorPixels, 0, 0);
    heightContext.putImageData(heightPixels, 0, 0);

    function makeTexture(canvas, color) {
      const texture = new THREE.CanvasTexture(canvas);

      texture.colorSpace = color
        ? THREE.SRGBColorSpace
        : THREE.NoColorSpace;

      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;

      texture.anisotropy = Math.min(
        8,
        structureRenderer.capabilities.getMaxAnisotropy()
      );

      texture.userData.interiorGenerated = true;
      return texture;
    }

    return {
      map: makeTexture(colorCanvas, true),
      bumpMap: makeTexture(heightCanvas, false),
    };
  }

  function addFace(inner, outer, angle, rotation, material) {
    const geometry = inner > 0
      ? new THREE.RingGeometry(
          inner, outer, 128, 1, angle, Math.PI
        )
      : new THREE.CircleGeometry(
          outer, 128, angle, Math.PI
        );

    const positions = geometry.attributes.position;
    const uv = geometry.attributes.uv;

    for (let i = 0; i < positions.count; i++) {
      uv.setXY(
        i,
        positions.getX(i) / (outer * 2) + 0.5,
        positions.getY(i) / (outer * 2) + 0.5
      );
    }

    uv.needsUpdate = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = rotation;
    structureModel.add(mesh);
  }

  const giant = [
    "Jupiter", "Saturn", "Uranus", "Neptune"
  ].includes(name);

  data.layers.forEach((layer, index) => {
    const inner = data.layers[index + 1]?.radius || 0;
    const core = layer.name.toLowerCase().includes("core");
    const rocky = name !== "Sun" && !giant && !core;

    const maps = makeLayerMaps(layer, index, rocky);

    const material = new THREE.MeshStandardMaterial({
      map: maps.map,
      bumpMap: maps.bumpMap,

      bumpScale: rocky ? 0.014 : 0.001,

      color: 0xffffff,
      roughness: rocky ? 0.94 : 0.65,
      metalness: core && !giant && name !== "Sun" ? 0.12 : 0,

      side: THREE.DoubleSide,
    });

    if (core || name === "Sun") {
      material.emissive.set(layer.color);
      material.emissiveMap = maps.map;
      material.emissiveIntensity = 0.12;
    }

    addFace(inner, layer.radius, Math.PI / 2, 0, material);

    addFace(
      inner,
      layer.radius,
      -Math.PI / 2,
      -Math.PI / 2,
      material
    );
  });
}

// ============================================================
// LAYER LEGEND
// ============================================================

function buildStructureLegend(name) {
  const data = INTERIORS[name];

  structureLegend.replaceChildren();

  const instructions = document.createElement("p");
  instructions.className = "structure-note";
  instructions.textContent =
    "Drag to rotate • Scroll to zoom. " +
    "A quarter of the globe is removed to expose two textured interior faces.";

  structureLegend.appendChild(instructions);

  for (const layer of data.layers) {
    const row = document.createElement("div");
    row.className = "structure-layer";
    row.style.setProperty("--layer-color", layer.color);

    const heading = document.createElement("h3");
    heading.textContent = layer.name;

    const description = document.createElement("p");
    description.textContent = layer.text;

    row.append(heading, description);
    structureLegend.appendChild(row);
  }

  const scientificNote = document.createElement("p");
  scientificNote.className = "structure-note";
  scientificNote.textContent =
    data.note +
    " Colors and procedural textures are illustrative, not observed " +
    "interior imagery. Layer thicknesses are schematic unless stated otherwise.";

  structureLegend.appendChild(scientificNote);
}

// ============================================================
// OPEN / CLOSE STRUCTURE VIEW
// ============================================================

function openStructureView(name) {
  if (!INTERIORS[name]) return;

  initializeStructureRenderer();

  if (!structureDialog.open) {
    resumeMainSimulation = !paused;
    paused = true;
  }

  structureTitle.textContent = `${name}: internal structure`;

  buildStructureModel(name);
  buildStructureLegend(name);

  structureCamera.position.set(-2.8, 0.8, 3.2);
  structureControls.target.set(0, 0, 0);
  structureControls.update();

  if (!structureDialog.open) {
    structureDialog.showModal();
  }

  resizeStructureViewer();

  structureRenderer.setAnimationLoop(() => {
    structureControls.update();
    structureRenderer.render(
      structureScene,
      structureCamera
    );
  });
}

structureClose.addEventListener("click", () => {
  structureDialog.close();
});

structureDialog.addEventListener("close", () => {
  structureRenderer?.setAnimationLoop(null);

  if (resumeMainSimulation) {
    paused = false;
  }

  resumeMainSimulation = false;
});

structureDialog.addEventListener("keydown", (event) => {
  event.stopPropagation();
});

// ============================================================
// BODY INFORMATION
// ============================================================

const BODY_INFO = {
  Sun: {
    type: "G2V main-sequence star",
    description:
      "The Sun contains about 99.86% of the Solar System's mass. " +
      "Nuclear fusion in its core powers the light and heat received by the planets.",
    facts: {
      "Mean diameter": "1,392,700 km",
      "Age": "About 4.6 billion years",
      "Photosphere temperature": "About 5,772 K",
      "Rotation": "About 25 days at the equator; slower near the poles",
      "Composition": "Mostly hydrogen and helium",
    },
  },

  Mercury: {
    type: "Terrestrial planet",
    description:
      "Mercury is the smallest planet and the closest to the Sun. " +
      "Its cratered surface has extreme temperature differences between day and night.",
    facts: {
      "Mean diameter": "4,879 km",
      "Mean distance from Sun": "57.9 million km",
      "Orbital period": "88 Earth days",
      "Axial rotation period": "58.6 Earth days",
      "Surface gravity": "3.70 m/s²",
      "Atmosphere": "Extremely tenuous exosphere",
    },
  },

  Venus: {
    type: "Terrestrial planet",
    description:
      "Venus has a thick carbon dioxide atmosphere and sulfuric acid clouds. " +
      "An intense greenhouse effect makes its surface hotter than Mercury's.",
    facts: {
      "Mean diameter": "12,104 km",
      "Mean distance from Sun": "108.2 million km",
      "Orbital period": "224.7 Earth days",
      "Axial rotation period": "243 Earth days, retrograde",
      "Mean surface temperature": "About 464 °C",
      "Surface pressure": "About 92 times Earth's",
    },
  },

  Earth: {
    type: "Terrestrial planet",
    description:
      "Earth is the only world currently known to support life. " +
      "Liquid oceans cover about 71% of its surface, and its atmosphere is mostly nitrogen and oxygen.",
    facts: {
      "Mean diameter": "12,742 km",
      "Mean distance from Sun": "149.6 million km — 1 AU",
      "Orbital period": "365.26 days",
      "Axial rotation period": "23 hours 56 minutes",
      "Surface gravity": "9.81 m/s²",
      "Natural satellites": "1 — the Moon",
    },
  },

  Moon: {
    type: "Earth's natural satellite",
    description:
      "The Moon rotates synchronously with its orbit, keeping approximately " +
      "the same hemisphere facing Earth. Its dark maria are ancient basaltic lava plains.",
    facts: {
      "Mean diameter": "3,475 km",
      "Mean distance from Earth": "384,400 km",
      "Orbital period": "27.32 Earth days relative to the stars",
      "Phase cycle": "29.53 Earth days",
      "Surface gravity": "1.62 m/s²",
      "Atmosphere": "Extremely tenuous exosphere",
    },
  },

  Mars: {
    type: "Terrestrial planet",
    description:
      "Iron-bearing minerals give Mars its reddish appearance. " +
      "Its surface preserves evidence of ancient rivers, lakes, and extensive volcanic activity.",
    facts: {
      "Mean diameter": "6,779 km",
      "Mean distance from Sun": "227.9 million km",
      "Orbital period": "687 Earth days",
      "Solar day": "24 hours 39 minutes",
      "Surface gravity": "3.71 m/s²",
      "Natural satellites": "2 — Phobos and Deimos",
    },
  },

  Jupiter: {
    type: "Gas giant",
    description:
      "Jupiter is the largest planet. Its visible bands and the Great Red Spot " +
      "are atmospheric features, not markings on a solid surface.",
    facts: {
      "Mean diameter": "139,820 km",
      "Mean distance from Sun": "778.6 million km",
      "Orbital period": "11.86 Earth years",
      "Rotation": "About 9 hours 56 minutes",
      "Atmosphere": "Mostly hydrogen and helium",
      "Major moons": "Io, Europa, Ganymede, Callisto",
    },
  },

  Saturn: {
    type: "Gas giant",
    description:
      "Saturn's prominent rings consist mainly of icy particles. " +
      "The planet has a low average density and a hydrogen-rich atmosphere.",
    facts: {
      "Mean diameter": "116,460 km",
      "Mean distance from Sun": "1.43 billion km",
      "Orbital period": "29.45 Earth years",
      "Rotation": "About 10.7 hours; estimates vary",
      "Ring composition": "Mostly water ice, with rocky material",
      "Notable moons": "Titan and Enceladus",
    },
  },

  Uranus: {
    type: "Ice giant",
    description:
      "Uranus rotates on its side compared with the other planets. " +
      "Methane absorption contributes to its pale blue-green appearance.",
    facts: {
      "Mean diameter": "50,724 km",
      "Mean distance from Sun": "2.87 billion km",
      "Orbital period": "84 Earth years",
      "Rotation": "About 17.2 hours, retrograde",
      "Axial tilt": "About 97.8°",
      "Rings": "Narrow, dark rings",
    },
  },

  Neptune: {
    type: "Ice giant",
    description:
      "Neptune is the outermost planet. Its atmosphere contains rapidly moving " +
      "clouds and changing storms. Natural-color views are less saturated than many popular images.",
    facts: {
      "Mean diameter": "49,244 km",
      "Mean distance from Sun": "4.50 billion km",
      "Orbital period": "164.8 Earth years",
      "Rotation": "About 16.1 hours",
      "Atmosphere": "Hydrogen, helium, and methane",
      "Largest moon": "Triton",
    },
  },
};

// ============================================================
// INFORMATION PANEL
// ============================================================

const panelStyle = document.createElement("style");

panelStyle.textContent = `
  #body-info {
    position: fixed;
    top: 16px;
    right: 16px;
    width: min(330px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    box-sizing: border-box;
    padding: 24px;
    color: #edf2f7;
    background: rgba(12, 17, 25, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 12px;
    font: 14px/1.6 system-ui, sans-serif;
    z-index: 10;
  }

  #body-info[hidden] {
    display: none;
  }

  #body-info h2 {
    margin: 0 36px 4px 0;
    font-size: 26px;
    line-height: 1.2;
  }

  #body-info .body-type {
    color: #a9bdd4;
    margin: 0 0 16px;
  }

  #body-info dl {
    margin: 18px 0;
  }

  #body-info dt {
    color: #a9bdd4;
    font-size: 12px;
    margin-top: 12px;
  }

  #body-info dd {
    margin: 2px 0 0;
  }

  #body-info .display-note {
    font-size: 11px;
    color: #9aa5b4;
    border-top: 1px solid #303944;
    padding-top: 12px;
  }

  #body-info-close {
    position: absolute;
    top: 10px;
    right: 12px;
    border: none;
    background: transparent;
    color: white;
    font-size: 26px;
    cursor: pointer;
  }
`;

document.head.appendChild(panelStyle);

const infoPanel = document.createElement("aside");
infoPanel.id = "body-info";
infoPanel.hidden = true;
infoPanel.setAttribute("aria-label", "Celestial body information");

const closeInfoButton = document.createElement("button");
closeInfoButton.id = "body-info-close";
closeInfoButton.type = "button";
closeInfoButton.textContent = "×";
closeInfoButton.setAttribute("aria-label", "Close information");

const infoContent = document.createElement("div");
infoContent.setAttribute("aria-live", "polite");

infoPanel.append(closeInfoButton, infoContent);
document.body.appendChild(infoPanel);

closeInfoButton.addEventListener("click", () => {
  infoPanel.hidden = true;
});

function showBodyInfo(name) {
  const data = BODY_INFO[name];
  if (!data) return;

  infoContent.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = name;

  const type = document.createElement("p");
  type.className = "body-type";
  type.textContent = data.type;

  const description = document.createElement("p");
  description.textContent = data.description;

  const facts = document.createElement("dl");

  for (const [label, value] of Object.entries(data.facts)) {
    const term = document.createElement("dt");
    term.textContent = label;

    const detail = document.createElement("dd");
    detail.textContent = value;

    facts.append(term, detail);
  }

  const note = document.createElement("p");
  note.className = "display-note";
  note.textContent =
    "Facts are approximate real-world values. Scene sizes, distances, " +
    "and animation speeds are compressed. Orbit lines are guides, not physical objects.";

  const structureButton = document.createElement("button");
  structureButton.type = "button";
  structureButton.className = "structure-open-button";
  structureButton.textContent = "View internal structure";

  structureButton.addEventListener("click", () => {
    openStructureView(name);
  });

  infoContent.append(
    title,
    type,
    description,
    facts,
    structureButton,
    note
  );

  infoPanel.hidden = false;
}

// ============================================================
// ORBIT PATHS
// ============================================================

const orbitLines = new THREE.Group();
orbitLines.name = "Orbit guides";
scene.add(orbitLines);

function makeOrbitLine(radius, color, opacity) {
  const points = [];
  const segments = 512;

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;

    points.push(
      new THREE.Vector3(
        Math.cos(angle) * radius,
        0,
        -Math.sin(angle) * radius
      )
    );
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);

  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  });

  return new THREE.LineLoop(geometry, material);
}

let moonOrbitGuide = null;

function createOrbitLines() {
  for (const definition of DEFINITIONS) {
    const line = makeOrbitLine(
      definition.distance,
      0x718097,
      0.28
    );

    orbitLines.add(line);
  }

  if (moon) {
    moonOrbitGuide = makeOrbitLine(1.65, 0x8a94a3, 0.3);
    moon.parent.add(moonOrbitGuide);
  }
}

window.addEventListener("keydown", (event) => {
  if (event.repeat) return;

  if (event.key.toLowerCase() === "o") {
    orbitLines.visible = !orbitLines.visible;

    if (moonOrbitGuide) {
      moonOrbitGuide.visible = orbitLines.visible;
    }
  }

  if (event.key === "Escape") {
    infoPanel.hidden = true;
  }
});

// ============================================================
// MAIN APPLICATION ENTRY POINT
// ============================================================

async function main() {
  try {
    const textures = await loadAssets();

    createBackground(textures.background);
    createSun(textures.sun);
    createPlanets(textures);

    createEarthLayers(textures);
    createVenusLayers(textures);
    createMoon(textures);
    createMarsAtmosphere();
    createSaturnRings(textures.saturnRings);
    createOrbitLines();
    updateBodies(0);
    scene.updateMatrixWorld(true);

    ready = true;
    renderer.setAnimationLoop(animate);
  } catch (err) {
    console.error("Initialization error:", err);
  } finally {
    // ALWAYS hide the loading screen when textures/scene setup completes
    hideLoadingScreen();
  }

  // Setup Navigation Help Toggle
  const helpToggle = document.getElementById("help-toggle");
  const helpPanel = document.getElementById("help-panel");
  const helpClose = document.getElementById("help-close");

  if (helpToggle && helpPanel && helpClose) {
    helpToggle.addEventListener("click", () => {
      helpPanel.hidden = !helpPanel.hidden;
    });

    helpClose.addEventListener("click", () => {
      helpPanel.hidden = true;
    });

    renderer.domElement.addEventListener("pointerdown", () => {
      helpPanel.hidden = true;
    });
  }
}

main();