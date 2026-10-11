# DRIFTWING — AIR NOMAD ART DIRECTION BIBLE
**Revision:** 2.0 concept / art-director review • **Date:** October 2026 • **Status:** proposed; not final game canon
**Source assets:** four revised Mediterranean + banner-lance character illustrations in `/assets/`. This revision supersedes the earlier bow/staff equipment descriptions wherever they conflict.

## 01 — Creative assignment
**North star:** *An Aegean-inspired civilization that learned to inhabit the sky with dragons.* A warrior is not the default fantasy; craftsmanship, travel, aerial navigation, ritual, and care for dragons are visible in the clothing.
**Emotional pillars:** liberating altitude; sunlit antiquity; gentle monumental scale; companionship rather than conquest.
**Player read in three seconds:** pale flowing cloth → simple under-armor scales → a monumental banner-lance standing against the sky.
**Mandatory signature:** when carrying a dragon-rider standard, a long banner must be attached near its head. A bare spear is not a canonical primary silhouette for this faction.

### Creative guardrails — must / may / must not
| MUST | MAY | MUST NOT |
|---|---|---|
| Draped Greco-Mediterranean silhouettes with short/saddle-safe variations | Different tunic hems and pins per profession | Pagoda-shaped cultural architecture as the *final* standard; it belongs to current reference art only |
| Broad stylized scales under cloth | Small bronze emblem or stamped border | Tiny realistic chain mail, ornate spiked plate, or western knight armor |
| Elegant sky-lance plus prominently attached banner | Small ceremonial leaf tip | Naked combat spear as sole hero prop; aggressive oversized blade |
| Accessible low-complexity mesh system | Cloth secondary motion via joints or baked shader | Mandatory real-time cloth on every costume or complex physics on every pennon |
| Full-body silhouette reads at gameplay zoom | Accent bronze, cobalt | Dense embroidery, all-over Greek key, jewelry overload |

## 02 — Reference interpretation
- **REF 01 — THE WANDERER:** `assets/AN_REF_01_Wanderer.png`. Source for figure scale, drape mass, pose, and banners; **not** a 360° model turnaround, not canonical back construction.
- **REF 02 — THE SCOUT:** `assets/AN_REF_02_Scout.png`. Source for figure scale, drape mass, pose, and banners; **not** a 360° model turnaround, not canonical back construction.
- **REF 03 — THE STANDARD BEARER:** `assets/AN_REF_03_StandardBearer.png`. Source for figure scale, drape mass, pose, and banners; **not** a 360° model turnaround, not canonical back construction.
- **REF 04 — THE ELDER:** `assets/AN_REF_04_Elder.png`. Source for figure scale, drape mass, pose, and banners; **not** a 360° model turnaround, not canonical back construction.
**Reference correction:** references still show East Asian rooflines and ornate serpentine dragons. Preserve their elevation, graceful scale and atmospheric layers. Rebuild the world architecture with cliffside limestone arcades, porticoes, terraces, bronze beacons, courtyards, cisterns, shade awnings, and wind-bridges; do not copy pagoda rooflines into approved level art.

## 03 — Faction identity and character read
- **Wardrobe grammar:** tunic/chiton foundation; asymmetrical shoulder cloak/chlamys; occasional larger himation-like shawl; waist sash; scale cuirass or bib beneath cloth; lightweight sandals, calf wrappings, and travel gaiters when functional.
- **Shape hierarchy:** (1) banner mass, (2) large torso drape, (3) scale panel, (4) sandal wraps, (5) one meaningful status accessory. Textures must never overtake shape.
- **Silhouette ladder:** Wanderer / Tender / Scout = compact; Pathfinder / Rider / Warden = active, medium; Channeler / Elder = tall, ceremonial, more cloth. A rider conversion exists for every long garment.
- **Motif:** one spiral indicating ascending wind / moving current, combined sparingly with sun disk, laurel, or simplified meander. One prominent insignia per design; texture micro-detail is not the identity.
- **Palette:** roughly 70% chalk / cream cloth, 20% sky-blue and blue-gray protective layer, 10% bronze / deep cobalt / sand. The numeric ratio is visual guidance, not per-pixel measurement.

## 04 — The banner-lance: signature design system
**Story-facing concept proposed for approval:** the lance is a *wind-standard*, a visible crest that lets people, dragons, and settlements recognize a rider and their route. It may also act as a signal staff or navigational ritual object. Any lore or gameplay effect remains subject to design approval.

| Component | Approved direction | Rejected direction |
|---|---|---|
| Shaft | Straight wood / muted bronze; spare grip wraps; slightly tapered; clear hand zones | Twisted high-detail fantasy staff or metallic battle halberd |
| Tip | Small rounded/leaf spear or open spiral finial (visual target: under ~10% total shaft height) | Large killing blade dominating the cloth |
| Banner | Large, long visible pennon mounted near the *top*, not a waist scarf | Tiny pennant tied low on shaft |
| Movement | Trailing arc with disciplined wind direction; 2–4 controlled joints or approved shader; handheld/mounted poses | Unlimited cloth simulation; erratic flapping that hides dragon/head/UI |
| Mount | Right/left hand grip and optional saddle holster validated with animations | Pole clipping through dragon neck or saddle |

**Three banner families:** A / Wayfinder = tapered single-tail; B / Rider = split swallowtail; C / Sanctuary = rectangular or broad split flag. Each uses a common shaft, tip kit, finial socket and cloth-material atlas. Banners vary by role/rank and faction insignia; they are not eight unshared objects.
**Scale starting point (nonfinal):** pole length about 1.3–1.6× standing humanoid height. Banner length about 0.8–1.4× pole length. Reassess for dragon scale, flying camera and FOV. The player should read the banner from behind the dragon without it occupying most of the viewport.
**Rider camera test:** in takeoff, left bank, hard right bank, dive, idle and high-speed flight, keep the standard visible but outside dragon eyes, rider face, primary forward route and gameplay information. Use a banner-fold/compressed variant at speed if needed.

## 05 — Wardrobe kit and materials
**Nine modular sockets:** BASE_CHITON • SCALE_BIB • DRAPE_SHOULDER • WAIST_SASH • LEG_LAYER • FOOTWRAP • BRACER • CLASP_STATUS • LANCE_STANDARD. Optional: PACK_UTIL, APRON, FLIGHT_TIE. Every role derives from approved base humanoid proportions.
**Materials:** dry linen / woven cloth (dominant), muted matte blue-gray dragon-scale underlayer, worn sand leather, softened bronze. Big roughness differences, small normal map detail. Avoid chrome, translucent silk, glossy scale-armor and hyperreal stitches.
| Color | HEX | Use |
|---|---|---|
| Chalk Linen | `#F2EADA` | Primary drape / silhouette anchor |
| Cloud White | `#FAF8F3` | Highlight panels and ceremonial cloth |
| Sky Blue | `#7FA8C4` | Soft sash/insignia; minor cloth mass |
| Deep Cobalt | `#315E9C` | Sparse hierarchy/rank accent only |
| Scale Slate | `#586875` | Simple protective underlayer |
| Aged Bronze | `#AA8656` | Pins, medallions, lance hardware |
| Limestone | `#D8D1C2` | Buildings / travel leather |
**Scale rule:** 3–5 readable rows with broad smooth interlocks where the chest or shoulder is visible; shader or large forms must survive 720p gameplay distance. These are *stylized scale under-armor*, not tiny mail.

## 06 — Eight design targets
| ID | Variant | Gameplay/social role | Strongest read | Banner family |
|---|---|---|---|---|
| AN-01 | Cloudpath Wanderer | Civilian / first-contact outfit | A medium-length split tunic, a single shoulder drape, a straight banner-lance and the quiet central scale panel. | A |
| AN-02 | Windward Scout | Route finder / forward lookout | Short crossed wrap, exposed forearms, lean bracers, diagonal hip pouch, upright signal pennon. | A |
| AN-03 | Zephyr Pathfinder | Messenger / aerial wayfinder | High shoulder mantle, two diagonal drapes and a doubled swallowtail banner with a forward-leaning posture. | B |
| AN-04 | Aerie Rider | Primary mounted player silhouette | Compact upper torso, secured scarf, scale chest, hip-strapped drapes, heroic lance and broad tail pennon. | B |
| AN-05 | Skybridge Warden | Sanctuary guard / sentinel | Squarer shoulders from a short cloak, heavier scale chest, tall flag and a stable plated-waist shape. | C |
| AN-06 | Drake Tender | Dragon handler / caretaker | Rolled shoulders, practical cross-wrap, utility belt and short one-tail standard. | A |
| AN-07 | Cloudsong Channeler | Sky ritualist / current-reader | Tall scarf arc, visible scale collar, slim silhouette and elongated ceremonial standard. | A |
| AN-08 | High Aerie Elder | Civic / ceremonial leader | Broad white mantle, double-pinned chiton, central scale bib, bronze medallion and the widest sacred banner. | C |

### AN-01 — Cloudpath Wanderer
**Role:** Civilian / first-contact outfit  
**Intent:** The baseline Air Nomad: a peaceful traveler who can still climb onto a dragon at a moment’s notice.  
**Read:** A medium-length split tunic, a single shoulder drape, a straight banner-lance and the quiet central scale panel.  
**Shared kit:** Short ivory chiton-style tunic; one shoulder-pinned chlamys; broad blue waist sash; simple scale vest; leather calf wraps; low sandals.  
**Unique elements:** One oversized bronze shoulder pin; a narrow plain pennon; single cloud spiral at hem.  
**Banner-lance:** Straight lance, small open-loop finial, narrow single-tail cream/blue pennon.  
**Riding conversion:** Convert long mantle to a shortened, shoulder-anchored flight fold; split front and back hem.  
**Materials:** Linen / soft bronze / chalk leather  
**Avoid:** Avoid excessive floating ribbons, full-length toga hems or chain-mail-scale pattern.  
**Primary visual reference:** REF 01 (`assets/AN_REF_01_Wanderer.png`).

### AN-02 — Windward Scout
**Role:** Route finder / forward lookout  
**Intent:** A practical early-warning silhouette, designed to read as fast and observant rather than martial.  
**Read:** Short crossed wrap, exposed forearms, lean bracers, diagonal hip pouch, upright signal pennon.  
**Shared kit:** Short asymmetrical tunic; reduced shoulder mantle; slim waist cord; broad chest scales; wrapped forearms; fitted travel sandals.  
**Unique elements:** Compact map satchel; shoulder clasp offset to opposite side; colored navigation tie at pole grip.  
**Banner-lance:** Tapered pennon with single cut tail, no oversized blade, clear dorsal blue stripe.  
**Riding conversion:** No loose fabric below knee; pouch moves to outer hip away from saddle.  
**Materials:** Dry cotton-linen / weathered pale leather  
**Avoid:** Do not add a quiver or bow as the primary weapon; standard is the hero prop.  
**Primary visual reference:** REF 02 (`assets/AN_REF_02_Scout.png`).

### AN-03 — Zephyr Pathfinder
**Role:** Messenger / aerial wayfinder  
**Intent:** The sharpest readable motion shape in the collection. Replaces the former archer brief.  
**Read:** High shoulder mantle, two diagonal drapes and a doubled swallowtail banner with a forward-leaning posture.  
**Shared kit:** Mid-thigh split tunic; one shoulder open; under-armor scale bib; high belted cloth; sandals with shin wraps.  
**Unique elements:** Sealed message cylinder; double shoulder pins; wrap with one cobalt triangular mark.  
**Banner-lance:** Split swallowtail standard; tall but lightweight shaft; small circular finial.  
**Riding conversion:** Wrist-mounted message cylinder; banner animation never crosses rider face or dragon eye.  
**Materials:** Dry pale linen / cloud-blue sateen trim  
**Avoid:** No permanent bow/archery silhouette; this is a flying courier with a banner-lance.  
**Primary visual reference:** REF 03 (`assets/AN_REF_03_StandardBearer.png`).

### AN-04 — Aerie Rider
**Role:** Primary mounted player silhouette  
**Intent:** The functional flight costume that every other outfit must eventually be tested against.  
**Read:** Compact upper torso, secured scarf, scale chest, hip-strapped drapes, heroic lance and broad tail pennon.  
**Shared kit:** Short sleeved or sleeveless chiton; fitted scale cuirass; blue cross-body sash; saddle-safe split panels; leather rider gaiters.  
**Unique elements:** Discrete saddle strap loops; reinforced palm grip; one mount clasp at hip; low neck mantle.  
**Banner-lance:** Broad pennon with two windstreamers; slot into approved saddle mount in flight.  
**Riding conversion:** Must pass saddle contact, takeoff, bank, dive, turning, dismount and first-person/third-person camera checks.  
**Materials:** Light linen / matte scale leather / bronze mount hardware  
**Avoid:** No cloth intersecting dragon neck, saddle, wings, hands or lance pole.  
**Primary visual reference:** REF 01 (`assets/AN_REF_01_Wanderer.png`).

### AN-05 — Skybridge Warden
**Role:** Sanctuary guard / sentinel  
**Intent:** A civic guardian, never a conventional steel-armored knight.  
**Read:** Squarer shoulders from a short cloak, heavier scale chest, tall flag and a stable plated-waist shape.  
**Shared kit:** Knee-length mantle over split chiton; simple shoulder-scaled underlayer; reinforced belt; cloth-covered shins.  
**Unique elements:** Two broad shoulder scales; bronze forearm cuffs; civic sun-and-cloud medallion.  
**Banner-lance:** Vertical rectangular standard with split trailing hem, compact stylized spear tip.  
**Riding conversion:** Swap rectangular cloth for a shorter pennon when mounted; keep clearance for dragon neck.  
**Materials:** Heavy linen / matte blue-gray scales / soft bronze  
**Avoid:** No full plate armor, huge pauldrons, exposed blades or militaristic uniform symmetry.  
**Primary visual reference:** REF 02 (`assets/AN_REF_02_Scout.png`).

### AN-06 — Drake Tender
**Role:** Dragon handler / caretaker  
**Intent:** A working garment expressing proximity, trust, and knowledge of dragons.  
**Read:** Rolled shoulders, practical cross-wrap, utility belt and short one-tail standard.  
**Shared kit:** Sleeveless short tunic with cross apron; simple central scale bib; crossed waist cord; ankle sandals; glove wraps.  
**Unique elements:** Soft food pouch; grooming hook (rounded, not barbed); ceramic salve jar; removable apron.  
**Banner-lance:** Long slender pennon mounted near upper pole, softly squared at head with narrow trailing end; care glyph.  
**Riding conversion:** Tether loose apron; rigid props on outer hip only.  
**Materials:** Sandstone linen / aged brown leather / ceramic  
**Avoid:** Do not imply dragon cruelty, cages, spiked whips or heavy industrial equipment.  
**Primary visual reference:** REF 01 (`assets/AN_REF_01_Wanderer.png`).

### AN-07 — Cloudsong Channeler
**Role:** Sky ritualist / current-reader  
**Intent:** A spiritual specialist whose dress follows the wind without becoming visual noise.  
**Read:** Tall scarf arc, visible scale collar, slim silhouette and elongated ceremonial standard.  
**Shared kit:** Long split tunic, draped himation-like mantle, blue wrapped sash, scale collar/bib; minimal bracers.  
**Unique elements:** One bronze ring at upper staff, hanging votive ribbons, simple stamped hem band.  
**Banner-lance:** Tapered flowing long pennon; optional three static interior stitch lines representing airflow.  
**Riding conversion:** Long ground robes swap to short rider layers; mantle secured at ribs.  
**Materials:** Woven ivory linen / soft light-blue trim / muted bronze  
**Avoid:** No glowing ornaments or magical glyph overload unless explicitly approved.  
**Primary visual reference:** REF 04 (`assets/AN_REF_04_Elder.png`).

### AN-08 — High Aerie Elder
**Role:** Civic / ceremonial leader  
**Intent:** The pinnacle of status: a recognizable descendant of the same garments, not a separate faction.  
**Read:** Broad white mantle, double-pinned chiton, central scale bib, bronze medallion and the widest sacred banner.  
**Shared kit:** Full chiton-style under-robe, wrapped diagonal mantle, restrained scale armor, calf straps and formal sandals.  
**Unique elements:** Large but flat bronze fibula; narrow geometric edging; one sash tassel; ceremonial shoulder fold.  
**Banner-lance:** Widest split-tail standard, modest gold edging, wind spiral and sun disk, never a war spear.  
**Riding conversion:** Alternate flight mantle required; cannot reuse long ceremonial cloth unchanged on saddle.  
**Materials:** Bleached linen / softened bronze / chalk-white scale  
**Avoid:** Avoid medieval wizard robe, jeweled staff or excessive ornament at every edge.  
**Primary visual reference:** REF 04 (`assets/AN_REF_04_Elder.png`).

## 07 — Dragon and architectural direction
**Dragon companion:** elegant winged, elongated silhouette with recognizable pale scale ridges; communicate intelligence and trust; do not overdesign with barbs and metallic armor. The four refs are mood exploration, not final dragon topology or skeletal spec. Scale relationships require art-direction approval.
**Settlement:** Aegean cliff portico + airship dock + public sanctuary: chalk limestone, blue painted plaster, sun-bleached canvas, circular windscreens, wind pylons, bronze signal bells, cisterns and bridges across cloud chasms. Columns are broad and simplified. No default pagoda roofs, paper lanterns or Japanese torii forms.
**Three environment shots requested:** daylight terrace marketplace with draped standards; dragon departure platform with flight tie-downs; distant cliff sanctuaries framed by cloud layers. Each should carry the same cream-blue-bronze palette.
**Focal hero shot requested:** rider mounted on dragon at takeoff with banner in full extension; one side profile and one standard gameplay camera view. The banner should be clear without hiding the dragon face.

## 08 — Stylized 3D implementation (provisional targets; engine confirmation required)
- **Triangles:** clothing + equipment ~3k–6k at gameplay LOD0 *as a starting estimate*, excluding shared body and dragon; do not treat this as an approved production budget.
- **Textures:** target 1K shared atlases / mask-driven palettes; expand to 2K only if close camera or hero marketing renders justify it. Aim for 2–3 outfit material slots where possible.
- **LOD:** candidate LOD1 near half, LOD2 around quarter; hide buckle charms before reducing the defining lance and hem shape. In-engine verify, do not use arbitrary fixed distances.
- **Rig:** one humanoid base; drapes on minimal auxiliary joints; banner on independent prop rig; standard held on hand socket and optional saddle socket. Wind direction controlled by animation/FX, not physically accurate sim.
- **No fixed engine assumption:** exports FBX / glTF as agreed; working files Blender / Maya compatible; review at actual gameplay zoom, target hardware and flight speed before final budgets.
- **Dragon contact points:** seat, thighs, inner knees, reins/hand grips, saddle post, dragon back and neck, banner arc, tail/body trajectory. Require animation tests before dress detail polish.
- **QA clips:** idle / run / climb / kneel / reach / mount / takeoff / left bank / right bank / full dive / hard brake / dismount. Record front, back, side and camera-pov screens.

## 09 — Approval gates, deliverables and responsibility
| Gate | Scope | Acceptance | Owner |
|---|---|---|---|
| G0 North Star | One-page style board, 4 refs, 3 banner families | Creative director approves Mediterranean vs legacy Eastern architecture correction | Art director |
| G1 Graybox | AN-01 base, AN-04 rider, shared lance + banner | Readable at gameplay zoom and safely mounted | Character lead + tech art |
| G2 Eight silhouettes | 8 costumes in plain values with banners | Roles differentiable without color and without face detail | Art director |
| G3 Lookdev | Palette, one representative material atlas, standards | 70/20/10 hierarchy, restrained bronze, readable scale panel | Art director + rendering |
| G4 In-engine | Flight + foot animation validation, LOD passes | No priority collisions / camera occlusions / huge performance spikes | Tech art + animation |
| G5 Asset release | Source project, exports, textures, turnarounds, manifest, usage notes | Reproducible imports, named sockets and modular variants | Art lead / integration |

**Asset naming:** `AN_CHAR_BASE`, `AN_OUTFIT_01_..._08`, `AN_LANCE_SHAFT_A`, `AN_LANCE_TIP_A`, `AN_BANNER_A/B/C`, `AN_SOCKET_HAND`, `AN_SOCKET_SADDLE`, `AN_DRAPE_SHORT_FLIGHT`. Place in `/characters/air_nomads`, `/props/standards`, `/env/aerie`, `/concept/references`.
**Required art boards for signoff:** 8 front/side/back neutral turnarounds; 8 grayscale silhouette tiles; 3 isolated lances and banners; 1 material and color sheet; 1 hero rider mounted contact sheet; 1 Mediterranean settlement language sheet. Current 4 illustrations do not replace these.

## 10 — Open creative decisions (art director to resolve)
1. Are these Air Nomads the main player culture, one region/faction, or a starting outfit family?
2. Are banner-lances held in flight, locked to saddle, or both? Do they convey actual gameplay signals or only lore?
3. Should ceremonial cloth be physically dynamic up close, or use bone/shader animation everywhere?
4. Final camera distance, target platform/engine and character poly/texture budget remain unconfirmed.
5. Final named emblem, gender/body diversity targets, and garment variation rules need approval.
**Final acceptance principle:** An unpainted gray model carrying only the drape, broad chest scales and long banner-lance must already read as this civilization.
