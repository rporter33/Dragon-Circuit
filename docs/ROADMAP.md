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

## Next: the airship — a mobile base

An airship you can call, board and steer becomes your **home**: the stable, your saddle racks and
your respawn point travel with it. That turns the world from one archipelago into many — the
airship carries you across the open sky between regions that would be too far to fly in one go.

**Why it fits.** The game is about flight, distance and landing to rest. An airship is a landing
spot that moves: it lets regions sit much farther apart (real journeys) without asking the player
to grind a crossing on stamina.

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
