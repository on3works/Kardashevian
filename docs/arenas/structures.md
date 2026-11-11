# Lightest Structure

**Verifier: physics.** In development: it runs in the lab but is not yet rated on kardashevian.com. Protocol `structures-v2` since October 2026.

The goal is an optimisation problem as close as possible to hard, real engineering, where marginal gains are impressive and the only limit is physics.

## The task

Design the **lightest bridge structure**, seen in elevation (2D), that carries every load case on every one of a set of **built units**. The model chooses the nodes, the members, each member's material and section, and whether each joint is pinned or rigid. It gets **8 attempts**. After each it sees the mass, score and an analysis report. In an attempt it may submit a design directly, or a program that may call the analysis up to 400 times within 90 seconds before committing one.

Each site is generated from a seed and specifies:

- **Span, supports and clearances:** fixed deck nodes, pinned, roller or spring supports on soft ground, an allowed region above and/or below the deck, and keep-out zones.
- **Materials and sections:** nine materials (four structural steels, stainless steel, two aluminium alloys, glulam timber and steel wire rope, which works in tension only) and eight section families, about 560 member options, each with published bands for strength, stiffness and thickness.
- **Loads:** deck dead load and self-weight, one or two lanes of traffic with dynamic amplification, crowds, braking, wind on every member, ice, temperature, support settlement, and a seismic case.
- **Checks:** section class, yield, flexural buckling on a buckling curve, bending interaction, shear, out-of-plane wind bending, deck deflection, lowest natural frequency, fatigue, corrosion and fabrication rules, with partial safety factors.

Every **built unit** draws its own steel strength, stiffness, section thickness, imperfections, settlement and temperature from the published bands, so a design must be robust rather than tuned to nominal values. Designs are scored on held-out units the model never sees.

## Grading

The model's best practice design is built **10 times** as held-out units, each loaded with its load cases. On each unit that passes every check, the design scores **100 × par mass / design mass**, so beating par scores above 100; a unit that fails any check scores 0. The arena score is the mean over the 10 units. Each site's **par** is the lightest of classic Pratt, Howe and Warren trusses above or below the deck at several depths, with pinned joints and S355 tubes, every member sized by iteration on the weakest allowed steel, then verified on every held-out unit. A textbook Pratt truss with one tube size throughout serves as the reference engineer.

Code: [code/src/structures/site2.mjs](../../code/src/structures/site2.mjs) (materials, sections, sites and load cases), [frame.mjs](../../code/src/structures/frame.mjs) (the 2D frame solver and checks), [par2.mjs](../../code/src/structures/par2.mjs) (par and reference designs) and [run2.mjs](../../code/src/structures/run2.mjs) (the brief and attempt loop). The first version, a 14-tube, two-variable world, is in [v1](../../code/src/structures/v1).

## Status

The arena is still being calibrated: whether the par is hard enough, and whether the 400-analysis budget is right. Its runs are published in [data/runs/structures](../../data/runs) as they happen, but it will not have a rating until the design is frozen.
