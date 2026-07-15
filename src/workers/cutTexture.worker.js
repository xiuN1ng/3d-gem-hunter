import * as THREE from 'three';
import { JadeVolume } from '../volume/JadeVolume.js';

self.addEventListener('message', (event) => {
  const { id, profile, normal, center, size, extent = 2.4, fast = false } = event.data;
  try {
    const volume = new JadeVolume(profile);
    const generated = volume.generateCutTextureData(
      new THREE.Vector3().fromArray(normal),
      new THREE.Vector3().fromArray(center),
      size,
      extent,
      { fast }
    );
    const buffer = generated.data.buffer;
    volume.dispose();
    self.postMessage({ id, size, buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
