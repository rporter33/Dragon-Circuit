# DRIFTWING — Air Nomad Individual Armor Component Design Pack

**Status:** art-direction concept, not approved production geometry.
**Basis:** revised Mediterranean Air Nomad character direction, banner-lances and eight shared outfits.
**Deliverables:** 12 numbered component cards (with vector-like front-shape diagrams), 4 wardrobe atlas references, slot and variation matrix.

## Creative north star
Aegean dragon-riders dressed in layered linen and discreet stylized scales. The protective armor is designed as a **removable underlayer**. Flowing cloaks, tunics, scarves and banner-lances remain separate modular props, and are not counted as armor. The banner-lance is the visual signature: long, wind-catching cloth attached near its top; it reads as a standard or navigational object more than a weapon.

## Production boundaries
- Large forms only: 3–5 broad scale rows; avoid chainmail micro-detail, chrome, barbs, spiked pauldrons, full fantasy plate.
- Armor is **matte** scale slate `#586875`, bronze `#AA8656`, linen `#F2EADA`, cobalt `#315E9C`, leather `#80634D`.
- Single shared base body and rig, shared atlases, replaceable L/R pieces; 12 components not 12 full outfits.
- Provisional LOD0 triangle estimates are scoping references, not engine-approved targets; confirm target hardware and camera scale.
- Three visual states: Light / Rider / Warden. Elder is largely cloth-over-armor and changes trim more than topology.
- Joint clearance, flight motion, saddle pressure and cloth conflicts require in-engine proof before high-detail modeling.

## Individual component specifications

### AN-AR-01 — Windscale cuirass
![Windscale cuirass](Individual_PNG_Design_Cards/AN-AR-01_Windscale_cuirass.png)

- **Slot:** SCALE_BIB
- **Category:** Torso / primary armor
- **Silhouette & role:** Sleeveless scaled vest with four broad interlocking rows. Flat chest, short waist, open sides for air flow.
- **Material treatment:** Slate blue matte scales, tan leather border, two subdued bronze studs.
- **Construction / assembly:** Front yoke + rear half joined by two side straps; no thick metal breastplate.
- **Proportion:** Neck base to just above natural waist; broad armholes for raised lance grip.
- **Geometry rule:** Four visible scale rows; 6-8 large plates per row, no micro-mail.
- **Variant rules:** Shared torso base; civilian: 3 rows; rider: 4; warden: 5; elder: pale 3.
- **Riding clearance test:** Check elbow and clavicle clearance; no contact with saddle pommel.
- **Preliminary LOD0:** 450-800 triangles (scope estimate).

### AN-AR-02 — Crossback flight harness
![Crossback flight harness](Individual_PNG_Design_Cards/AN-AR-02_Crossback_flight_harness.png)

- **Slot:** FLIGHT_BACK
- **Category:** Torso back / flight restraint
- **Silhouette & role:** Low-profile X-back leather harness with a central padded dorsal scale tab and saddle-safe tether loops.
- **Material treatment:** Sand leather, one matte scale panel, dark bronze rings.
- **Construction / assembly:** Two diagonal straps cross between shoulder and ribs; 2 side release tabs, 1 center spine anchor.
- **Proportion:** Strap width visually 1/14 of chest width; spine anchor short and flat.
- **Geometry rule:** Harness sits on top of cloth but beneath shoulder drape; no backpack mass.
- **Variant rules:** Scout: lighter; rider: dual saddle tabs; tender: utility attachment; warden: wider straps.
- **Riding clearance test:** Cannot press into seated spine or interfere with mount/dismount.
- **Preliminary LOD0:** 250-500 triangles (scope estimate).

### AN-AR-03 — Windline scale collar
![Windline scale collar](Individual_PNG_Design_Cards/AN-AR-03_Windline_scale_collar.png)

- **Slot:** SCALE_COLLAR
- **Category:** Neck / clavicle
- **Silhouette & role:** Low open collar formed by three short overlapping scale sections protecting collarbone without enclosing throat.
- **Material treatment:** Ivory fabric piping, blue slate scales, worn bronze edge.
- **Construction / assembly:** Flexible crescent on a soft collar base; single rear fastening with leather tongue.
- **Proportion:** No taller than the lower neck; avoid chin collision when diving.
- **Geometry rule:** Outer collar reads as one continuous gentle U rather than rigid armor.
- **Variant rules:** Wanderer: none; pathfinder: half; channeler: blue; elder: ceremonial bronze rim.
- **Riding clearance test:** Full pitch and head turn; shoulder mantle must slide over, not through.
- **Preliminary LOD0:** 100-220 triangles (scope estimate).

### AN-AR-04 — Aerie shoulder scales
![Aerie shoulder scales](Individual_PNG_Design_Cards/AN-AR-04_Aerie_shoulder_scales.png)

- **Slot:** SHOULDER_SCALE
- **Category:** Shoulder / pauldron pair
- **Silhouette & role:** Mirrored shallow shoulder caps, each 2-3 wide dragon scales following deltoid instead of square knight plates.
- **Material treatment:** Blue-gray slate scales with ivory inner lining and one bronze pivot pin.
- **Construction / assembly:** Pinned at upper arm / neck strap; soft flex section separates shoulder from torso.
- **Proportion:** Outer edge stops above upper arm midline; cap must not meet jaw.
- **Geometry rule:** Silhouette deliberately compact; asymmetry optional by replacing one with a drape.
- **Variant rules:** Rider: one cap; warden: two broad caps; elder: both hidden by mantle.
- **Riding clearance test:** Allow full forward arm extension for lance and wingbank animation.
- **Preliminary LOD0:** 220-440 triangles (scope estimate).

### AN-AR-05 — Upper-arm sail cuff
![Upper-arm sail cuff](Individual_PNG_Design_Cards/AN-AR-05_Upper-arm_sail_cuff.png)

- **Slot:** UPPER_ARM_GUARD
- **Category:** Upper arm / soft scale
- **Silhouette & role:** A cloth-lined sleeve cuff with two broad protective scale ridges following bicep; no full cylinder armor.
- **Material treatment:** Matte blue scale, soft linen, narrow bronze seam.
- **Construction / assembly:** Open inner upper arm; textile tie at back of bicep; not rigid plate tube.
- **Proportion:** Hem stops well above the elbow crease.
- **Geometry rule:** Large clean surface; only two ridges in silhouette.
- **Variant rules:** Scout: none; rider: left only; warden: matching pair; tender: bare cloth wraps.
- **Riding clearance test:** Arm twisting and reaching must not pinch elbow or cloak.
- **Preliminary LOD0:** 120-210 triangles (scope estimate).

### AN-AR-06 — Stormward bracers
![Stormward bracers](Individual_PNG_Design_Cards/AN-AR-06_Stormward_bracers.png)

- **Slot:** FOREARM_BRACER
- **Category:** Forearm / paired
- **Silhouette & role:** Tapered forearm guards with one clean bronze-bound central ridge over wrapped wrists.
- **Material treatment:** Matte blue-gray or sand leather, one bronze strip, cream underwrap.
- **Construction / assembly:** Simple one-piece tapered shell over cloth, two leather tie points under forearm.
- **Proportion:** Length ~55% of forearm; open at wrist, elbow stays exposed.
- **Geometry rule:** Forearm silhouette uses one broad plane; scales embossed at most twice.
- **Variant rules:** Wanderer: fabric; rider: one reinforced cuff; warden: bronze rim; elder: blue wrap.
- **Riding clearance test:** Wrist bending for reins and grip; no contact when hands cross torso.
- **Preliminary LOD0:** 180-350 triangles (scope estimate).

### AN-AR-07 — Lance-grip hand guards
![Lance-grip hand guards](Individual_PNG_Design_Cards/AN-AR-07_Lance-grip_hand_guards.png)

- **Slot:** GRIP_GLOVE
- **Category:** Hands / riding glove pair
- **Silhouette & role:** Fingerless leather hand protection with one wide padded grip band over palm; back of hand partially open.
- **Material treatment:** Warm leather, sand wraps, tiny slate scale pad, no sharp knuckles.
- **Construction / assembly:** Separate thumb wrap + wrist tie; palms slightly padded on lance hand.
- **Proportion:** Must preserve clear fingertips and reins finger curl.
- **Geometry rule:** No gauntlet fingers; gloves should still read as hands.
- **Variant rules:** Scout: cloth tape; rider: reinforced palm; warden: scale back pad; elder: bare.
- **Riding clearance test:** Must not obscure first-person weapon grip and banner mounting animation.
- **Preliminary LOD0:** 140-280 triangles (scope estimate).

### AN-AR-08 — Bronze-sash waist guard
![Bronze-sash waist guard](Individual_PNG_Design_Cards/AN-AR-08_Bronze-sash_waist_guard.png)

- **Slot:** WAIST_GUARD
- **Category:** Waist / cinch guard
- **Silhouette & role:** Wide flexible sash cinch with discrete rigid front and side protective scale panels.
- **Material treatment:** Cobalt-blue woven sash, worn bronze round clasp, leather lining.
- **Construction / assembly:** Cloth belt passes under two small scale slips; buckle at front or left hip.
- **Proportion:** Belt width 9-12% of torso height; no heavy fauld around waist.
- **Geometry rule:** One clean band and clasp; hanging cloth is a separate garment socket.
- **Variant rules:** Wanderer: plain; rider: saddle latch; tender: pouches; warden: additional scale band.
- **Riding clearance test:** No bulk at hip hinge or seat; tie tails stow during flight.
- **Preliminary LOD0:** 160-320 triangles (scope estimate).

### AN-AR-09 — Split hip tassets
![Split hip tassets](Individual_PNG_Design_Cards/AN-AR-09_Split_hip_tassets.png)

- **Slot:** HIP_TASSET
- **Category:** Outer hips / hanging guard pair
- **Silhouette & role:** Two short trapezoid scale aprons to shield outer hips; separated front and rear for dragon saddle.
- **Material treatment:** Slate scales, linen backing, softly patinated bronze ring attachments.
- **Construction / assembly:** Each panel hangs from hip belt ring; independent L/R variants, no connected armor skirt.
- **Proportion:** Stop above knee; hem 1-2 large scallops only.
- **Geometry rule:** Read as two purposeful plates rather than skirt armor.
- **Variant rules:** Scout: left only; rider: narrow bilateral; warden: broader; elder: concealed.
- **Riding clearance test:** Gap at inner thigh and saddle seat; do not ride over dragon flank.
- **Preliminary LOD0:** 180-400 triangles (scope estimate).

### AN-AR-10 — Cloudstep knee cups
![Cloudstep knee cups](Individual_PNG_Design_Cards/AN-AR-10_Cloudstep_knee_cups.png)

- **Slot:** KNEE_CUP
- **Category:** Knees / paired
- **Silhouette & role:** Two low-profile oval knee protectors over cloth trousers, with one shallow scale ridge.
- **Material treatment:** Scuffed bronze over dark blue leather; cloth at rear joint.
- **Construction / assembly:** Elastic-like cloth band at top and below knee, hard shell anterior only.
- **Proportion:** Cup height less than half shin-width; no projecting points.
- **Geometry rule:** Knee anatomy stays compact under draped cloth.
- **Variant rules:** Scout: soft wraps; rider: thin cups; warden: bronze-faced; elder: none.
- **Riding clearance test:** Deep crouch, mount knee clamp, and kneel must remain possible.
- **Preliminary LOD0:** 100-200 triangles (scope estimate).

### AN-AR-11 — Skywrap greaves
![Skywrap greaves](Individual_PNG_Design_Cards/AN-AR-11_Skywrap_greaves.png)

- **Slot:** SHIN_GREAVE
- **Category:** Shin / paired
- **Silhouette & role:** Long narrow exterior shin guard integrated with traditional leather calf lacing and woven ankle wraps.
- **Material treatment:** Slate dragon scale facing (2 broad bands), tan leather, pale wrap cloth.
- **Construction / assembly:** One shallow frontal shell with straps looping behind calf; no metal boot cylinder.
- **Proportion:** Top below knee; ankle left free and flexible.
- **Geometry rule:** Reads as wrapped legs first and armor second.
- **Variant rules:** Wanderer: no shell; rider: two; warden: reinforced pair; channeler: linen only.
- **Riding clearance test:** Tucked away from dragon flank; protect boot/cloth from clipping in saddle.
- **Preliminary LOD0:** 220-440 triangles (scope estimate).

### AN-AR-12 — Rider-sole sandals
![Rider-sole sandals](Individual_PNG_Design_Cards/AN-AR-12_Rider-sole_sandals.png)

- **Slot:** RIDER_FOOT
- **Category:** Foot / paired
- **Silhouette & role:** Mediterranean strapped leather sandal with optional toe and instep scale guard for mount protection.
- **Material treatment:** Worn leather, linen underwrap, two matte blue scale slips.
- **Construction / assembly:** Three broad strap loops; reinforced heel and sole; foot remains readable.
- **Proportion:** Minimal sole bulk; calves free for wrapping.
- **Geometry rule:** Prefer sandals for standard looks; closed rider shoe available by functional swap.
- **Variant rules:** Wanderer: sandal; rider: protected toe; warden: short rider boot; elder: formal straps.
- **Riding clearance test:** Foot must fit stirrup/strap anchor without snagging; no dangling laces.
- **Preliminary LOD0:** 220-480 triangles (scope estimate).

## Standard attachment order
1. Body rig and split chiton / trousers.
2. Windscale vest + flight back harness + low scale collar.
3. Shoulder scales, upper arm cuffs, bracers, and grip guards.
4. Waist guard and optional paired tassets.
5. Knee cups, wrapped greaves and strapped rider soles.
6. Sash, cloak, mantle, role pouches and banner-lance in **separate sockets**.

## Suggested 8 role loadouts
| Role | Armor emphasis | Cloth conversion |
|---|---|---|
| Cloudpath Wanderer | vest light, cloth bracers, sandals | medium split tunic, single chlamys |
| Windward Scout | half collar, single bracer, one tasset | short double-wrap, stow streamers |
| Zephyr Pathfinder | vest light, wrist guards, travel greaves | scarf secured, messenger pouch at outer hip |
| Aerie Rider | vest rider, crossback, gloves, greaves | saddle-safe split drape and low mantle |
| Skybridge Warden | vest heavy, two shoulder scales, knee cups | squared cloak, no knight silhouette |
| Drake Tender | vest light, one bracer, utility waist | short apron, no rigid inner-hip props |
| Cloudsong Channeler | collar, restrained bracers | broad shawl on ground, compact during flight |
| High Aerie Elder | pale vest, bronze trim and formal clasps | broad ceremony mantle swaps to flight mantle |

## Dragon-standard / banner-lance (separate signature prop)
Shaft length provisional ~1.3–1.6× the standing rider height. A small rounded/leaf/open-spiral finial, one large banner attached near the top, and optional saddle holster. Three banner cuts: tapered wayfinder, split rider swallowtail, broad sanctuary. Test camera occlusion and wing interference. Not counted as armor.

## Review gates for art director
- **G1:** approve all 12 grayscale silhouettes as distinct assets at game zoom.
- **G2:** make proper front/side/back orthographics of every unique geometry family and exploded strap studies. Current card silhouettes and generated atlases are **concept cues**, not complete orthographic technical reference.
- **G3:** model the vest, bracer, greave and protected sandal first as an integrated rider prototype.
- **G4:** test all eleven animation states (idle, locomotion, reach, mount, takeoff, bank left, bank right, dive, brake, land, dismount) and banner clearance.
- **G5:** only then approve texture atlases, LOD reductions, and eight role variants.

## Asset naming / suggested sockets
`AN_AR_01_SCALE_CUIRASS` through `AN_AR_12_RIDER_SOLE`, derived per role as variants; piece names are **proposed** and subject to pipeline convention.

**Design provenance:** Concept artwork is interpretive and may contain visually inconsistent trims or details. Use the numbered component cards as the authored geometry brief, with the atlases as mood/material references only.