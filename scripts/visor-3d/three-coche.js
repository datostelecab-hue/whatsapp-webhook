// ============================================================
// THREE.JS PARA EL COCHE 3D — la entrada del paquete
// ============================================================
// El visor del coche (public/assets/js/coche3d.js) usa three.js, que se sirve
// desde nuestro propio servidor y no desde un CDN: un solo fichero,
// public/assets/vendor/three-coche.min.js, con SOLO las piezas que usa el
// visor. Este fichero dice cuáles son; el paquete deja en `window.THREE_COCHE`
// exactamente esto.
//
// El paquete no se toca a mano: se regenera con esbuild (fuera del repo, en una
// carpeta cualquiera con three instalado):
//
//   npm i three@0.186.1 esbuild@0.25
//   NODE_PATH=<carpeta>/node_modules npx esbuild scripts/visor-3d/three-coche.js \
//     --bundle --minify --format=iife --global-name=THREE_COCHE \
//     --legal-comments=eof --outfile=public/assets/vendor/three-coche.min.js
//
// Si el visor empieza a usar otra clase de three.js, se añade aquí y se
// regenera. three.js es MIT; la licencia queda al final del paquete.

export {
  WebGLRenderer, Scene, PerspectiveCamera, PMREMGenerator,
  ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace,
  DirectionalLight, Mesh, PlaneGeometry, ShadowMaterial,
  Sprite, SpriteMaterial, CanvasTexture,
  Vector2, Vector3, Raycaster,
} from 'three';
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
export const REVISION = '186';
