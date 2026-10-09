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
  pop out of the turf, sun geckos basking on old stone that glide off the rim on their ribs when a
  shadow falls, butterflies and fireflies, fish in the pools that feed the waterfalls.
- *Plants:* flora that reacts to you and the world — blooms that open at dawn and close at dusk,
  luminous night plants, wind-harp reeds that sing in gusts, seed-pods that drift on thermals.
- Built on the systems already here: instanced, GPU-animated, steered by the shared wind field and
  day/night uniforms, with simple flocking and flee-from-the-wyvern behaviour.

**An unknown Greco-Roman past.** The ruins already in the Drift (the Old Observatory, cairns and
standing stones) become part of one lost civilization with a fantastical Greco-Roman character:
colonnaded temples on island crowns, broken aqueducts arching from island to island (and threading
through races), amphitheatres carved into cliffs, wind-shrines with bronze vanes, colossal statues
of riders and wyverns half-swallowed by trees, switchback ramps and reliefs left by the four-legged
bearers that carried the stone, mosaics on terrace floors, inscriptions in a script
the player slowly learns to read. Their placement tells a story: why the islands float, who
charted the winds, who carried the stone, where the riders went.

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

**Leap and call (after the dragon pass).** Today, walking off an island's edge makes your wyvern
swoop in and catch you after a moment. The full version makes it a move you choose:
- a running leap off any edge;
- freefall you steer with your body;
- a whistle that calls your wyvern from wherever it is, with real travel time, ending in a dive
  and a mid-air catch into the saddle.

It builds on the existing fall-and-catch (`Player.startFall` / `catchRider`).

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
- *The Verdant Shelf* — huge overgrown islands, waterfalls the size of mountains, ancient ruins,
  and the last wild drakes (below).

## Then: the drake — a four-legged dragon from beyond the Drift

Every mount in the Drift is a wyvern: two legs, with the arms as wings, wing-walking on its wrists
like a pterosaur. That stays the heart of the game. The **drake** answers "why not dragons too?":
four true legs *and* wings, arriving with the first region the airship reaches. It is one creature
you earn, not a second stable of breeds: a different way to explore, not a better wyvern.

*Status: proposed (2026-10-09), pending two decisions.*
- The client chooses between this glide-only drake and a classic flapping six-limbed dragon. The
  panel advises against the six-limbed dragon: it would fly like a heavier wyvern breed and break
  the "they are reptiles" rule.
- The dragon expert signs off on its size, gait and tack.

**Why a drake, not a heraldic dragon.** Every backboned animal that beats its wings built them from
its arms, and none has six limbs. A reptile with four legs and wings does exist: the gliding
lizards of genus *Draco* (Latin for "dragon") spread a membrane on long ribs and steer with their
hands on its edge. Scaled up, that is the drake. Rib-wings can't beat, so it rides and flies
differently by nature, not by tuning. The six-limbed dragon stays in the game as Ventari heraldry,
which Quintus gently corrects.

**Why it fits.** The game is about landing to rest and exploring what you land on, and a floating
island always has a drop below it.
- *On the ground* it is the weightiest ride in the game: a crocodile's high walk with a slow,
  rolling trunk, short gallops, and scrambles up ramps, ledges and root curtains too steep for
  anything else (about 60°, against 40° today). Its wings fold back along its flanks, off the ground.
- *In the air* it never beats. It launches by running off an edge or dropping from height and flies
  on speed and rising air: thermals, gusts, ridge lift along big island faces. Its hands on the
  wing's leading edge steer it and pump a brief zoom (the flap button).
- *Stamina* goes on scrambling, galloping and holding a high-lift wing, and comes back on any stone
  it lands on, fastest basking in the sun. Every island in its region has a way up from below.
- *Each needs the other.* Wyverns keep powered flight, speed and every race. The drake reaches the
  cliff-cut ruins wyverns can't land at, and in time the Ventari works it restores give the wyverns
  new thermals and routes.

**How it plugs in.**
- *A shared creature core first.* The gait already moves four contacts (`gait.ts`), the body is
  lofted from keys (`rig.ts`), the hide is shaded in body space, and the rider mounts by named
  sockets (seat, pommel, steps). One refactor makes limb roles data (wing-hand, walking foreleg,
  rib-fan) with no change to the wyverns, proved by the golden-pose test. Head, hide, eyes, tail,
  breathing, LODs and the capture harness are shared, not copied.
- *What's new.* Forelegs built and solved like the hind legs; a rib-fan wing that folds along the
  flank; a high walk, gallop and scramble; an edge launch and a sit-back landing; a saddle and girth
  that clear the wing's root. The fan replaces the arm-wing's bones, so it fits the 64-bone budget.
- *Flight.* The same `FlightModel`, with a row in `flight/breeds.ts` that has no flap thrust and a
  camber input. Ghosts and saves already key on the breed id.
- *Its own class.* The drake isn't one of the racing breeds, so "every breed medals every course"
  stays true. Its berth is the airship's larger stable, and it travels with the ship: it can't cross
  open sky on its own.
- *Shared tech.* The edge launch reuses the leap, freefall and catch from "jump off the islands and
  call"; scrambling extends the airship deck's moving ground to steep surfaces.

**How you get one.** The Drift hints at drakes long before you meet one: sun geckos that glide off
the rim on their ribs, switchback ramps too shallow for people and too narrow for wyverns, a relief
of a four-legged winged beast hauling stone, a harness too broad for any wyvern. The Ventari called
them the bearers. They carried the stone for the aqueducts and were left behind when the riders flew
west; their descendants still live wild on the Verdant Shelf. Catalogue them, finish the bearers'
Antiquities chain and restore the old harness at the Codex, and a wild drake at a Ventari bearer
station will accept it.

**The first version.**
- *A glide test first.* Before any art, a no-flap row in `flight/breeds.ts` is flown on a wyvern
  body through the Drift. If gliding on rising air isn't fun, the drake stops here.
- *Wild drakes* on the Verdant Shelf: seen, followed and catalogued, never hostile. They prove the
  body in motion at gameplay distance.
- *One rideable drake* (one species, one size) with the harness unlock, in a region built for it:
  lift along the glides, a scramble route from underside or rim to crown on every island, and ruins
  only it can reach.

**The full version** adds hauling (dragging fallen bronze vanes up the bearer ramps to their shrines
brings the wind back for the wyverns), drake glide trials with their own medals, wild clutches in
warm mounds with a guarding mother, bonding shared with the wyverns, and drakes for AI rivals.

**Gates.** Nothing is built until:
- the wyverns, Vellum included, pass the fidelity bar (Q1–Q16) with no open majors;
- the slice has shipped and the airship can reach a second region;
- the dragon expert has signed off, in writing, the drake's size, gait, glide-only flight and tack;
- the creature-core refactor has merged with the wyverns' golden poses unchanged.

The rideable drake starts only after the wild ones read and move right at gameplay distance and the
expert has seen them in motion. If the expert can't accept a rib-glider at mount scale, the drakes
stay wild and small, and the sturdier ground ride becomes a wyvern breed under **More breeds**.

**Done when** the drake meets the wyverns' bar restated for its body:
- the folded fan stays clear of the ground;
- no foot slips on a walk or a scramble;
- it mounts from the foreleg within 1.5 s;
- the girth clears the wing root in every frame;
- it uses at most 64 bones, and a mixed three-creature scene stays within 60k triangles.

Plus three rules:
- it can't be stranded: from every island crown, a glide reaches lift or a scramble route;
- it is a choice, not an upgrade: wyverns keep climb, speed and races;
- the wyverns' captures and budgets are unchanged.

## Later

- **AI rival riders** in races. The flight model is already independent of the player
  (`FlightModel` + the race autopilot that flies every course in the tests); rivals reuse it with
  per-rider skill, line choice and personality.
- **More breeds** with their own handling niches (more wyverns; if the drake's gates fail, its sturdier
  ground ride comes back here as a wyvern breed), and **wyvern bonding** (a wyvern that learns your
  habits: cosmetic flourishes, idle animations, calls).
- **Photo mode extensions** (filters, poses, a gallery) and **shareable ghosts** (export/import a
  best run as a file).
- **Touch controls** for tablets, once performance budgets allow.
