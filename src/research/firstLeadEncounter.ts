import { Vector3 } from 'three';
import type { GameEventBus } from '../core/events';
import type { VentariSiteAnchor } from '../core/types';
import type { Interactable } from '../game/contracts';
import { FIRST_LEAD_TRANSLATION } from './firstLeadText';

export function shrineInteraction(site: VentariSiteAnchor, events: GameEventBus, read: () => void): Interactable {
  // Stand in front of the slab rather than inside its collision volume.
  const position = new Vector3(site.inscription.x + Math.sin(site.yaw) * 1.5,
    site.inscription.y, site.inscription.z + Math.cos(site.yaw) * 1.5);
  return {
    id: 'read:gullrest-shrine', position, radius: 2,
    prompt: { action: 'interact', text: 'Read the inscription' },
    onInteract() {
      for (const part of ['site', 'inscription'] as const) events.emit('survey', {
        siteId: site.id, part, name: 'Shrine of the First Wind', position: position.clone(),
        text: part === 'inscription' ? FIRST_LEAD_TRANSLATION : undefined,
      });
      read();
    },
  };
}
