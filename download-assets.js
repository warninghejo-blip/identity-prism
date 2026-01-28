import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEXTURE_DIR = path.join(__dirname, 'public', 'textures');

if (!fs.existsSync(TEXTURE_DIR)) {
  fs.mkdirSync(TEXTURE_DIR, { recursive: true });
}

const ASSETS = {
  // MERCURY
  'mercury_map.jpg': 'https://planetpixelemporium.com/download/download.php?mercurymap.jpg',

  // VENUS
  'venus_map.jpg': 'https://planetpixelemporium.com/download/download.php?venusmap.jpg',
  'venus_atmosphere.jpg': 'https://planetpixelemporium.com/download/download.php?venusbump.jpg',

  // EARTH
  'earth_daymap.jpg': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg',
  'earth_normal.jpg': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_normal_2048.jpg',
  'earth_specular.jpg': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_specular_2048.jpg',
  'earth_clouds.jpg': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_clouds_1024.png',

  // MARS
  'mars_map.jpg': 'https://planetpixelemporium.com/download/download.php?mars_1k_color.jpg',
  'mars_normal.jpg': 'https://planetpixelemporium.com/download/download.php?mars_1k_normal.jpg',

  // JUPITER
  'jupiter_map.jpg': 'https://planetpixelemporium.com/download/download.php?jupitermap.jpg',

  // SATURN
  'saturn_map.jpg': 'https://planetpixelemporium.com/download/download.php?saturnmap.jpg',
  'saturn_ring.jpg': 'https://planetpixelemporium.com/download/download.php?saturnringcolor.jpg',

  // URANUS & NEPTUNE
  'uranus_map.jpg': 'https://planetpixelemporium.com/download/download.php?uranusmap.jpg',
  'neptune_map.jpg': 'https://planetpixelemporium.com/download/download.php?neptunemap.jpg',

  // SUN
  'sun_map.jpg': 'https://planetpixelemporium.com/download/download.php?sunmap.jpg',
};

console.log('🚀 Starting texture download to /public/textures/ ...');

const MIN_BYTES = 5_000;
const MAX_REDIRECTS = 5;

function downloadFile(url, filePath, redirectCount = 0) {
  if (redirectCount > MAX_REDIRECTS) {
    console.error(`❌ Too many redirects for ${url}`);
    return;
  }

  https
    .get(url, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location) {
        response.resume();
        downloadFile(location, filePath, redirectCount + 1);
        return;
      }

      if (status !== 200) {
        response.resume();
        console.error(`❌ Failed ${url} (HTTP ${status})`);
        return;
      }

      const file = fs.createWriteStream(filePath);
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        const size = fs.statSync(filePath).size;
        if (size < MIN_BYTES) {
          console.warn(`⚠️ ${path.basename(filePath)} looks too small (${size} bytes).`);
        } else {
          console.log(`✅ Downloaded: ${path.basename(filePath)}`);
        }
      });
    })
    .on('error', (err) => {
      fs.unlink(filePath, () => {});
      console.error(`❌ Failed ${url}:`, err.message);
    });
}

Object.entries(ASSETS).forEach(([filename, url]) => {
  const filePath = path.join(TEXTURE_DIR, filename);
  downloadFile(url, filePath);
});
