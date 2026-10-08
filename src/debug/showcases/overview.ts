import { Vector3 } from 'three';
import type { Showcase } from '../showcase';

/** ?view=overview — a high wide shot of the archipelago around the Roost. */
const overview: Showcase = {
  name: 'overview',
  description: 'High wide shot over the Roost toward Cascade Isle',
  setup(game) {
    game.cameraRig.setOverride({ position: new Vector3(-420, 620, 760), target: new Vector3(300, 300, -300) });
  },
};

export default overview;
