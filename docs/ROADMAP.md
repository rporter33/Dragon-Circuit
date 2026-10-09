# Driftwing — roadmap

What's in the first release, and what comes after it. Ideas here are commitments in direction, not
in detail; each gets its own design pass before it's built.

## First release (this build)

- One archipelago — the Drift — with twelve landmarks, ~50 islands, thermals, day/night and weather.
- Four wyvern breeds that fly differently; a customizable rider; cosmetics unlocked by exploring
  (48 feathers, 7 relics) and racing (medals).
- Seven races (five ring courses, two point-to-point sprints) with a ghost of your best run.
- Forgiving stamina that rewards landing: islands are places to rest, not obstacles.
- Controller-first controls with full keyboard and mouse support.

## Next: a living Drift, its forgotten past, and research

The archipelago should feel inhabited and old: alive in the air and on the islands, and layered
over the ruins of a civilization nobody remembers. Everything you find there feeds **research**,
and research builds up the airship (below).

**Ambient life (never hostile).**
- *In the air:* flocks of sky-swifts that wheel and scatter as you pass, gliding manta-like
  driftrays riding thermals (follow one to find lift), migrating herds of small wyverns at dusk,
  dragonflies and pollen motes over meadows, seabird colonies on cliff faces.
- *On the islands:* grazing woolly ruminants that look up as you land, burrowing creatures that
  pop out of the turf, butterflies and fireflies, fish in the pools that feed the waterfalls.
- *Plants:* flora that reacts to you and the world — blooms that open at dawn and close at dusk,
  luminous night plants, wind-harp reeds that sing in gusts, seed-pods that drift on thermals.
- Built on the systems already here: instanced, GPU-animated, steered by the shared wind field and
  day/night uniforms, with simple flocking and flee-from-the-wyvern behaviour.

**An unknown Greco-Roman past.** The ruins already in the Drift (the Old Observatory, cairns and
standing stones) become part of one lost civilization with a fantastical Greco-Roman character:
colonnaded temples on island crowns, broken aqueducts arching from island to island (and threading
through races), amphitheatres carved into cliffs, wind-shrines with bronze vanes, colossal statues
of riders and wyverns half-swallowed by trees, mosaics on terrace floors, inscriptions in a script
the player slowly learns to read. Their placement tells a story: why the islands float, who
charted the winds, where the riders went.

**Research points.** Discovering things is the progression that drives the airship:
- *Catalogue* a creature or plant by getting close (or watching it for a moment) → a journal entry
  with a painted plate and notes.
- *Survey* ruins: land, walk the site, read inscriptions and mosaics → lore entries and fragments of
  the old script.
- *Chart* the winds: ride every thermal, find hidden updrafts, complete races → chart pages.
- Each entry awards research points in a branch (Natural History, Antiquities, Winds). Research
  unlocks airship upgrades — range (which regions you can sail to), comfort (a larger stable, more
  saddle racks, a dining deck), instruments (a wind compass that shows thermals, a lore lens that
  reveals inscriptions) — and cosmetics inspired by what you found.
- The current collectibles (feathers, relics) and landmark discoveries fold into this: they become
  the first research entries rather than a separate system.

## Then: the airship — a mobile base

An airship you can call, board and steer becomes your **home**: the stable, your saddle racks and
your respawn point travel with it. That turns the world from one archipelago into many — the
airship carries you across the open sky between regions that would be too far to fly in one go.

**Why it fits.** The game is about flight, distance and landing to rest. An airship is a landing
spot that moves: it lets regions sit much farther apart (real journeys) without asking the player
to grind a crossing on stamina. Research (above) is how it grows: every creature catalogued, ruin
surveyed and wind charted makes the ship more capable and lets it reach farther.

**How it plugs in.**
- *Home anchor.* The stable location and the last-resort respawn point already go through a single
  "home" abstraction (`src/player/home.ts`), with the Roost as the default. An airship is a home
  that moves; the stable screen, prompts and respawn follow it.
- *Moving ground.* The airship's deck is a set of colliders (`src/world/colliders.ts`) whose
  transform changes each frame. Landing on it needs ground velocity in the player's landed/on-foot
  states (stand still on a moving deck), which is the main new piece of physics.
- *Regions.* The world layout becomes a list of regions, each its own seeded archipelago with its
  own palette, weather tendencies, landmarks, collectibles and races. Only the current region (plus
  the one you're sailing toward) is built; the rest are data.
- *Travel.* Steering the airship is slow and stately (a different camera and control set); a
  "sail to" map lets you pick a discovered region and watch the crossing, or fly alongside it.

**Region ideas** (each with a distinct look and a flight challenge):
- *The Emberwastes* — dark basalt spires over a sea of orange cloud, strong thermals, heat shimmer.
- *Frostveil* — ice-capped islands, aurora nights, cold air that drains stamina faster but gives
  stronger ridge lift along glaciers.
- *The Hollow Reaches* — islands with tunnels and caves you can fly through; lanterns and echoes.
- *Stormbreak* — a permanent weather front with lightning (still non-hostile: visibility and wind
  are the challenge), rewarding precise flying with rare relics.
- *The Verdant Shelf* — huge overgrown islands, waterfalls the size of mountains, ancient ruins.

## Later

- **AI rival riders** in races. The flight model is already independent of the player
  (`FlightModel` + the race autopilot that flies every course in the tests); rivals reuse it with
  per-rider skill, line choice and personality.
- **More breeds** with their own handling niches, and **wyvern bonding** (a wyvern that learns your
  habits: cosmetic flourishes, idle animations, calls).
- **Photo mode extensions** (filters, poses, a gallery) and **shareable ghosts** (export/import a
  best run as a file).
- **Touch controls** for tablets, once performance budgets allow.
