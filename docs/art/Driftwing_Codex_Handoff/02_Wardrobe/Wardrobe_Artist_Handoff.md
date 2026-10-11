# Air Nomad Wardrobe & Equipment System

**Version:** 1.0 | October 2026  
**Scope:** 8 modular stylized outfits designed from 4 existing visual references for a dragon-based game.

> **Interpretation:** This document specifies new garment designs and proposed unseen construction. The four source images are visual mood/shape references, not complete turnarounds. Approve rear views and rigged blockouts before detailed production.

## Faction art direction

- Dominant ivory fabric and muted sky blue trim, slate-scale underlayer, brown functional belts and boots.
- Under-armor: 3-5 rows of broad simplified dragon-like scales. It should read as a layer, not an ornate suit.
- Shared wraps, belts, soft boots, cloud-swirl insignia, two or three large cloth folds.
- Mounted outfits have tucked or swapped cape/scarf components; no physically simulated loose fabric required.

### Palette

| Material | Hex | Usage |
|---|---|---|
| Cloud ivory | `#F3ECDD` | Main cloth, 55-65% |
| Bone white | `#FBF8EF` | Inner tunic / highlights |
| Sky blue | `#9BB9D3` | Trim, scarf, insignia |
| Slate blue | `#5E7C95` | Under-armor and dark panels |
| Stone gray | `#80888B` | Light armor and wrappings |
| Weathered brown | `#746254` | Belts, footwear and packs |
| Dull bronze | `#A99677` | Minimal fasteners |
| Storm blue | `#3C566C` | Rare rank-specific contrast |

### Modular slots

BASE_TUNIC, SCALE_UNDERLAYER, OUTER_TORSO, SCARF_SHOULDERS, BRACERS, WAIST_SASH, TROUSERS, BOOTS, BACK_CLOTH, UTILITY_ATTACHMENTS

## Eight wardrobe options

### AN-01 — Cloudpath Wanderer

**Role:** ENTRY / GENERAL TRAVEL | **Complexity:** LOW | **Reference:** REF 01

The recognizable baseline silhouette. Almost everything in the range should feel like a variation of this outfit.

**Read at gameplay distance**

- Long cream scarf crossing the upper chest
- Short sky-blue oversash, loose trousers, wrapped boots
- Small center chest window of simple slate scale-mail

**Palette:** Cloud ivory 60% / sky blue 18% / stone gray 12% / brown 10%

**Build recipe**

| Slot | Construction |
|---|---|
| Base | Straight off-white tunic with open side vents; use the same body layer for all eight looks. |
| Scale layer | Small slate scale bib from collarbone to sternum; 3 broad stepped rows only. |
| Outer torso | Sleeveless crossed cream tabard, one asymmetric front overlap; no etched embroidery. |
| Shoulders | One broad scarf fold draped left-to-right; second end trails no farther than upper thigh. |
| Forearms | Plain gray cloth wraps; narrow darker cuff on the weapon hand. |
| Waist | Blue fabric sash with one simple leather keeper strap and flat circular clasp. |
| Legs | Roomy tapered cream trousers, single knee fold and ankle tuck. |
| Boots | Shared brown soft boots with broad cloth bindings, no individual tiny laces. |
| Back | Short fabric overlap to seat height; keep mount contact area flat. |
| Extras | One side pouch; optional flat spiral marking on scarf only. |

**New modeled parts:** Baseline tunic, scarf A, scale bib A, sash A, trouser A, boot A. Build these first.

**Proposed back/side:** Back: straight tabard seam centered; scarf emerges over right shoulder. Side: slim waist and broad calf volume.

**Dragon interaction:** Riding version ties both scarf ends into the waist; no cloth draping across saddle contact.

**Separate props:** Optional plain walking staff, not part of the costume mesh.

### AN-02 — Windward Scout

**Role:** SCOUT / EXPLORATION | **Complexity:** LOW-MEDIUM | **Reference:** REF 02

A practical route finder who can sprint, climb and mount a dragon without hanging fabric.

**Read at gameplay distance**

- Shorter split hem and tighter sleeves than AN-01
- Diagonal belt, low-profile pouches and spear loop
- Visible chest scale patch, otherwise mostly cloth

**Palette:** Cloud ivory 45% / slate blue 25% / sky blue 15% / brown 15%

**Build recipe**

| Slot | Construction |
|---|---|
| Base | Reuse fitted base tunic with sleeve rolled to just below elbow. |
| Scale layer | Reuse bib A; add narrow two-row scale inset under right shoulder only. |
| Outer torso | Hip-length cream jacket with a diagonal overlap and split rear seam. |
| Shoulders | Narrow neck wrap with a short single tail, not a long streamer. |
| Forearms | Shared wrapped bracers plus one slate-blue wrist guard. |
| Waist | One angled leather strap across blue sash; two flat map pouches at side. |
| Legs | Narrower trouser variant with reinforced fabric knee patches. |
| Boots | Shared bound boot with simplified raised toe-cap shape. |
| Back | Compact rolled travel blanket clipped high above pelvis. |
| Extras | Spear socket/strap placed outside saddle grip zone. |

**New modeled parts:** Jacket B, shoulder scale inset, compact scarf B, utility belt B, rolled pack.

**Proposed back/side:** Back: V-shaped split jacket tail; pack centered between shoulder blades. Side: flattened pouches, no hanging hardware.

**Dragon interaction:** Limit scarf tail to shoulder blade; spear must detach or align with back to avoid wings and reins.

**Separate props:** Simple travel spear is a separate prop asset; hand socket needed.

### AN-03 — Zephyr Ranger

**Role:** RANGED / ARCHERY | **Complexity:** MEDIUM | **Reference:** REF 03

Fast aerial lookout. Dress for shoulder rotation and drawing a bow before ornament.

**Read at gameplay distance**

- Sleeveless or open-shoulder layered upper garment
- Slim scale panel around heart and ribcage
- Short side cape, quiver and thigh-safe bow clearance

**Palette:** Cloud ivory 48% / sky blue 20% / slate blue 17% / brown 15%

**Build recipe**

| Slot | Construction |
|---|---|
| Base | Shared tunic with cropped sleeve cap and reinforced underarm. |
| Scale layer | Scale vest C: broad 4-row front panel; very little armor around draw shoulder. |
| Outer torso | Crossed light wrap with left-side hem shorter than right; visibly flexible torso. |
| Shoulders | One airy scarf loop, short tails pinned beneath quiver strap. |
| Forearms | Left armguard is a simple single plate over cloth; right arm uses wraps only. |
| Waist | Blue sash + narrow quiver belt resting above upper hip. |
| Legs | Tapered trouser A with outer thigh split cloth strip. |
| Boots | Shared wrapped boots with lower gaiter variant. |
| Back | Quiver harness anchored high on back or side; never block wing-saddle clearance. |
| Extras | One pale-blue cloud glyph on hem. Quiver uses six low-poly arrow silhouettes. |

**New modeled parts:** Scale vest C, armguard, cross-wrap C, quiver belt, quiver, short cape strip.

**Proposed back/side:** Back: diagonal quiver strap; leave far shoulder free. Side: clean bowstring arc from nose to hand.

**Dragon interaction:** Prefer side-quiver when mounted; animated cloth must not intersect bow draw.

**Separate props:** Bow, arrows and quiver separate from clothing; allow left- or right-handed mirror pass.

### AN-04 — Aerie Rider

**Role:** DRAGON RIDER / FLIGHT | **Complexity:** MEDIUM | **Reference:** REF 01

The default flight uniform: recognizable air-nomad colors with tighter, safer geometry at the saddle.

**Read at gameplay distance**

- High scarf collar, zero free-flowing fabric while mounted
- Wide scale front panel and short hip-length coat
- Two visible harness straps as the signature form

**Palette:** Cloud ivory 38% / slate blue 30% / sky blue 15% / brown 17%

**Build recipe**

| Slot | Construction |
|---|---|
| Base | Reuse close-fitting tunic with longer wrist coverage. |
| Scale layer | Scale vest D across chest and upper back: 4 or 5 stepped rows, no tiny scales. |
| Outer torso | Waist-length double-split rider coat, tightly bound at rear. |
| Shoulders | Stiff folded hood-scarf collar attached to coat; no trailing tail in mounted state. |
| Forearms | Paired wrist bracers with single large shape each. |
| Waist | Two broad leather harness straps cross sash; blank quick-release buckle plate. |
| Legs | Fitted riding pants with a flat inner thigh and knee reinforcement. |
| Boots | Shared boot with grippy heel and reduced calf wraps. |
| Back | Flat harness anchor over spine; cape removed in mount variant. |
| Extras | Small map pouch high at rear waist, not on thigh. |

**New modeled parts:** Rider coat D, scale vest D, harness D, snug trousers D, mount-safe collar.

**Proposed back/side:** Back: Y-harness meeting at a central flat plate. Side: no geometry projects from buttocks or inner knee.

**Dragon interaction:** Priority variant. Test seated/mounted, banking left/right, hard dive and over-shoulder camera.

**Separate props:** Use dragon saddle attachment sockets; no physically simulated loose fabric required.

### AN-05 — Skybridge Warden

**Role:** GUARD / DEFENSE | **Complexity:** MEDIUM | **Reference:** REF 02

A heavier guardian silhouette without introducing ornate plate armor or losing the faction identity.

**Read at gameplay distance**

- Broader shoulders, squared short mantle and cleaner symmetry
- Largest simple scale cuirass in the range
- Blue waist panel and sturdy wrapped boots

**Palette:** Cloud ivory 32% / slate blue 38% / sky blue 16% / brown 14%

**Build recipe**

| Slot | Construction |
|---|---|
| Base | Shared padded ivory under-tunic with longer collar. |
| Scale layer | Scale chest E: 5 broad visible rows; extend one stepped row around ribs. |
| Outer torso | Short boxy tabard with clean flat hem, split at hip for stride. |
| Shoulders | Soft layered cloth shoulder mantles, armor only hinted by edge thickness. |
| Forearms | Both bracers use shared gray shell with one added larger cuff band. |
| Waist | Wider sky-blue belt sash, central dull-bronze plate; no hanging rings. |
| Legs | Standard tapered pants with blocky knee pad cloth. |
| Boots | Bound boots with thicker cuff and flat tread detail. |
| Back | Short caplet ending at lower ribs, no cloak. |
| Extras | One simple rank stripe on upper-arm mantle. |

**New modeled parts:** Broad scale E, box tabard E, paired soft mantles; mostly reuse shared parts.

**Proposed back/side:** Back: armor mesh follows shoulder blades; caplet stops above seat. Side: blocky shoulder/waist contrast.

**Dragon interaction:** Can ride, but caplet should auto-hide when seated; shield should attach to back socket.

**Separate props:** Optional round shield and spear; separate low-detail prop kit.

### AN-06 — Drake Tender

**Role:** HANDLER / SUPPORT | **Complexity:** LOW-MEDIUM | **Reference:** REF 01

The working outfit for feeding, healing and tending dragons; more utilitarian than martial.

**Read at gameplay distance**

- Rolled forearms and visibly open movement at elbows
- Cross-body satchel and broad working apron front
- Minimal armor, maximum cloth and leather utility

**Palette:** Cloud ivory 55% / brown 24% / sky blue 12% / slate blue 9%

**Build recipe**

| Slot | Construction |
|---|---|
| Base | Shared cream tunic with sleeves pushed above wrist. |
| Scale layer | Small scale panel F under outer tunic, only visible at neckline and side. |
| Outer torso | Short sleeveless wrap vest plus front apron panel ending just above knees. |
| Shoulders | Utility neckerchief, tucked with no free tail. |
| Forearms | Heavy single-color fabric wraps; plain glove optional. |
| Waist | Wide working belt with two closed pouches and flat tie cords. |
| Legs | Baggy cream trousers, dirt-tinted ankle wraps. |
| Boots | Reuse plain bound boots; one slightly darker material tint. |
| Back | Cross-body satchel sits on side of hip opposite dragon mounting leg. |
| Extras | Three large kit forms: brush, vial case, folded bandage. Avoid tiny bottles. |

**New modeled parts:** Work vest F, apron F, toolkit pouch cluster, satchel F.

**Proposed back/side:** Back: crossed vest tie; satchel rests on rear hip. Side: short apron does not intersect crouch pose.

**Dragon interaction:** Satchel can hide/tuck during mounted state; no sharp metal near creature body.

**Separate props:** Dragon care kit should be one merged low-poly prop or two attachments.

### AN-07 — Cloudsong Channeler

**Role:** WIND MYSTIC / SUPPORT | **Complexity:** MEDIUM | **Reference:** REF 04

A restrained spellcaster with a strong flowing contour but few material changes.

**Read at gameplay distance**

- Long central cloth panel and layered wide sleeves
- Scale underlayer barely visible beneath a V-shaped opening
- Single elegant scarf arc, no floating ornament clutter

**Palette:** Cloud ivory 63% / sky blue 22% / slate blue 9% / bronze 6%

**Build recipe**

| Slot | Construction |
|---|---|
| Base | Shared robe tunic lengthened to knee with one rear walking slit. |
| Scale layer | Reuse narrow scale bib A; lighten material slightly, keep size unchanged. |
| Outer torso | Long wrap robe with V opening, vertical blue front panel. |
| Shoulders | One high folded collar with two cloth tails limited to knee height on foot. |
| Forearms | Wide bell sleeve silhouette over hidden narrow wrap cuff. |
| Waist | Soft double sash, simple circular flat clasp; no chains. |
| Legs | Tapered shared pants mostly concealed beneath robe. |
| Boots | Standard bound boot; no new boot sculpt. |
| Back | Robe length to mid-calf, but fold and shorten cloth during riding. |
| Extras | Printed cloud-swirl stripe near sleeve hem, not modeled geometry. |

**New modeled parts:** Long robe G, bell sleeves G, scarf G. Reuse neck, belt clasp and shoes.

**Proposed back/side:** Back: V-shaped seam down upper back, no massive cape. Side: sleeve should clear staff grip.

**Dragon interaction:** Use a knee-length mounted robe swap; long foot robe not intended for saddle poses.

**Separate props:** Staff optional; glow particles and spell FX belong to VFX pipeline.

### AN-08 — High Aerie Elder

**Role:** ELDER / CEREMONIAL | **Complexity:** MEDIUM-HIGH | **Reference:** REF 04

The maximum-status version of the faction without becoming a separate art style.

**Read at gameplay distance**

- Long formal wrap layers and distinctive blue shoulder strip
- A measured gray scale front panel and staff
- One circular ornament, longer beard/hair silhouette

**Palette:** Cloud ivory 58% / sky blue 22% / slate blue 14% / bronze 6%

**Build recipe**

| Slot | Construction |
|---|---|
| Base | Shared long robe base; hem just above ankles. |
| Scale layer | Scale chest H: 4 broad rows with blue-gray tint, under long drape. |
| Outer torso | Double crossed front robe with two wide triangular panels; keep seams straight. |
| Shoulders | Broad cream shawl plus one continuous sky-blue drape over shoulder. |
| Forearms | Shared cloth-wrapped bracers beneath loose sleeve ends. |
| Waist | Double sash with flat circular buckle and two wide simple tassels. |
| Legs | Standard pants, largely hidden; no new geometry required. |
| Boots | Same wrapped boot silhouette in slightly lighter tint. |
| Back | Formal long mantle to lower calf on foot; waist-lock mantle for mounted cut. |
| Extras | One staff jewel and simplified hair tie. No dangling metal chains. |

**New modeled parts:** Formal mantle H, long robe H, collar H, modified scale front; simple staff.

**Proposed back/side:** Back: symmetrical mantle with one blue vertical stripe. Side: layered cloth depth reads as 3 broad plates.

**Dragon interaction:** Elder is foot-first. Mounted version swaps lower mantle for shorter tabard and tucks scarf.

**Separate props:** Staff with blue orb is a separate prop. Hair and beard simplified to grouped shapes.

## Technical production targets

- **Scope:** clothing + optionally detachable equipment; base body excluded from outfit budget.
- **Provisional triangle target:** ~3k–6k triangles for clothing/gear at LOD0. Adjust for engine, hardware and camera; it is not a universal limit.
- **Under-armor:** 3–5 broad rows of 5–8 large shapes where exposed; distant detail can be normal/print.
- **Materials:** 2–3 slots per outfit, shared cloth / scales-leather / metal palette.
- **Textures:** start at 1024x1024; optional 2048 hero treatment only when closeup justified.
- **LODs:** LOD1 approximately 50%; LOD2 approximately 20–30% triangle count.
- **Cloth:** use short rigged scarf tails; avoid obligatory physics. Mounted variants tuck or swap long items.
- **Rig:** one approved humanoid skeleton; test run, climb, crouch, raise arms, bow/staff, seated riding, bank/dive, dismount.

## Required artist handoff

1. A shared mannequin/base body with a consistent rig and dimensions agreed with the game developer.
2. Eight visible outfits assembled from modular named parts, with interchangeable scarf, scale underlayer, outer garment, sash, trouser and boot meshes.
3. Native editable scene + FBX or GLB/GLTF exports (choose one export convention with developer).
4. Per variant: front, back, side and 45-degree screenshots, one action pose, and mounted proof where relevant.
5. All textures and color masks, material names, tri counts, LODs and asset usage manifest.
6. List of new meshes and shared reused meshes by variant; no duplicate geometry without reason.

## Approval gates

1. Approve AN-01 graybox and the simplified scale-mail treatment.
2. Test AN-04 early with the real dragon saddle and riding animations.
3. Graybox all 8 outfits before texturing.
4. Validate materials, LODs and clipping with actual gameplay camera and lighting.
5. Export/import final assets and sign off.

## Reference image filenames

- `ref/REF01_Wanderer.png` — traveler; baseline costume silhouette.
- `ref/REF02_Spear_Scout.png` — scout/warden spear silhouette.
- `ref/REF03_Archer.png` — ranger armor and arm mobility.
- `ref/REF04_Elder.png` — ceremonial cloth language.

## Outstanding decisions (do not assume)

- Engine, export standard, skeleton, platform and target gameplay camera distance.
- Dragon saddle geometry and whether outfit meshes are visible while riding.
- Whether outfits require dye swaps, gender/body sliders, wet/dirty variants, NPC LODs.
- Whether cloth uses bones, procedural sway, or simulation (default here: bones only).
