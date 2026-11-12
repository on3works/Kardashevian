# Lightest Structure

**Verifier: physics.** In development: it runs in the lab but is not yet rated on kardashevian.com. 3D (`structures-v3`) since 12 Nov 2026; the 2D versions are retired.

The goal is an optimisation problem as close as possible to hard, real engineering, where marginal gains are impressive and the only limit is physics.

## The task

Design the **lightest three-dimensional bridge structure** that carries every load on every one of **10 built units**. Axes: x along the bridge, y up, z across. The model places nodes anywhere in an allowed region, connects them with members, picks each member's material and section (about 560 options), and makes each joint pinned or rigid. It gets **8 attempts**; after each it sees mass, score and an analysis report. An attempt is either a design or a program that may call our analysis up to 400 times in 90 seconds before committing one.

Each site is generated from a seed:

- **Geometry.** Span 18–60 m, deck 4–9 m wide, with deck nodes along both edges. Four bearings under the deck corners: one fixed, the others guided so the deck can breathe; some sites anchor both ends, some bearings sit on soft ground. A **traffic envelope** over the roadway that no node or member may enter, an allowed region above and/or below the deck, and sometimes a channel, railway or road below.
- **Loads.** Deck dead load; one or two lanes of traffic, off-centre so they twist the deck, with a dynamic factor; crowds over any stretch, full width or one side only; braking; cross-wind on every member and on the deck edge; ice; temperature; earthquakes from any horizontal direction; settlement of any one bearing.
- **Materials.** Nine: four structural steels, stainless steel, two aluminium alloys, glulam timber, and steel wire rope (tension only). Each built unit draws its own strength, stiffness, density, thickness and buckling imperfection inside published bands.

## Checks

The analysis is a 3D frame solver (six degrees of freedom at rigid joints, pinned ends released, cables that slacken in compression). A design must pass on every built unit:

- **Members:** yield, flexural buckling about both axes on a buckling curve, biaxial bending and axial interaction (moments from rigid joints, self-weight, ice and wind between nodes), shear, section class.
- **The whole structure:** global elastic buckling factor at least 3–5 under every factored case (a compression chord with nothing holding it sideways fails here even when every member passes), no mechanism in any direction, deck sag and sideways sway limits, lowest natural frequency in any direction, fatigue from traffic, corrosion allowance.
- **Robustness:** any single wire rope or solid rod may snap; the rest must still carry dead load and half the traffic.

Each built unit is tested with the **proof load** (the heaviest vehicle in every lane at midspan) and seven unseen cases drawn from the published ranges.

## Scoring

On each unit that passes every check, the design scores **100 × M_min ÷ its mass**; a unit that fails any check scores 0. The arena score is the mean over the 10 units.

**M_min is a lower bound on the mass of any structure for the site.** The deck's dead load and the proof load produce a bending moment M(x) that must be carried within the allowed depth H, so the forces crossing each section satisfy Σ|N| ≥ |M|/H, and the material weighs at least (ρ/f)·∫|M|/H dx with the best density-to-strength ratio in the catalogue. Self-weight, buckling, stiffness, bracing, joints, the other load cases and robustness only add mass, so **100 cannot be reached**. Scores are small numbers; ratings count results within 2% of each other as draws.

A **reference engineer** design anchors the rating: a conventional braced truss hung under the deck, every member a round S355 tube sized by iteration until all ten units hold. In offline checks it scored about 0.2–2. A site where it cannot be made to hold is replaced by the next seed.

Code: [site3.mjs](../../code/src/structures/site3.mjs) (sites, loads, built units), [frame3.mjs](../../code/src/structures/frame3.mjs) (3D solver, checks, lower bound), [ref3.mjs](../../code/src/structures/ref3.mjs) (reference design), [brief3.mjs](../../code/src/structures/brief3.mjs) (the brief) and [run2.mjs](../../code/src/structures/run2.mjs) (the attempt loop shared with v2).

## History

- **v1** (Oct 2026): 14 tube sizes, one material, two design variables. Saturated quickly.
- **v2** (Oct – 12 Nov 2026): a 2D bridge seen in elevation, scored against a textbook-truss par. The cheapest models beat par by 35–81% within eight attempts, so it was retired.
- **v3** (12 Nov 2026 –): this page.

Retired sites remain in [data/runs/structures](../../data/runs), labelled retired.
