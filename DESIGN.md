# Woodturning Game Design

Ideas captured from Brandon, November 11, 2026.

## The pitch

A satisfying woodturning game where you plant a tree, wait for it to grow, chop it down swipe by swipe, turn the log on a spinning lathe with a chisel that cuts exactly where you press it, paint it while it spins, finish it with a sheen, and sell it or deliver it against a commission.

The core is a feeling, not a feature list. The inspiration was a turning-only game Brandon played once and found deeply satisfying. This game takes that one satisfying part and builds the full pipeline around it: growing, harvesting, milling, turning, painting, finishing, and selling.

It sits in the unique, cozy, niche category. People like unique cozy niche things, and they pay for them when the core interaction feels good.

## The core loop in one sentence

Commission asks for a piece, grow the right tree, chop it, turn it to shape, paint it spinning, finish it, get paid by how close you got.

The full loop:

1. Take a commission or decide what to make
2. Plant and grow the right type of tree
3. Chop the tree down
4. Delimb the log
5. Saw the log into a turning blank
6. Turn the blank on the lathe
7. Paint it on the lathe
8. Spray on a finish and check the sheen
9. Sell it in the shop or deliver the commission
10. Buy new chisels, new wood types, and more land, then repeat

## Harvesting, step by step

### Chop the tree down

Swipe from one side into the side of the tree. The cut lands where you swiped.

Keep swiping and the cuts bite deeper into the trunk, in the places you actually hit. When you have cut far enough through, the tree cracks and falls.

It has to look good: visible notches where the swipes landed, wood giving way, and a clear crack and fall at the end, not a tree that just tips over after a health bar empties.

### Delimb the log

Once the tree is down, take a blade and cut the branches off the log.

Same principle as chopping: the action happens where the player works on the log, so cleaning the log up feels like work they did, not a button they pressed.

### Saw the blank

Take the cleaned log and saw it in two places to get the piece you are going to turn.

View is top down on the log. The saw action is rubbing back and forth across the log, swiping with a finger, until the cut goes through. Do that twice and the middle piece becomes the turning blank.

## The lathe is the heart of the game

Everything else supports this part. If turning is not satisfying, nothing else matters, so this is the part to prototype and prove first.

### How the cutting works

Spin a real 3D wood log and cut only where the player presses the chisel in.

A turned log is a shape spun around an axis. Its whole shape can be described as the radius at each point along its length. Cutting is lowering that radius at the exact spot the chisel touches. That means:

- The chisel only cuts where it presses, by construction
- A cut is a real groove in the 3D surface, not a mark drawn on top
- Chips fly off at the contact point while the chisel is cutting
- The finished shape is the profile the player actually carved

### Chisel tips

Tap to select between different chisel tips, and the tip on the chisel on screen changes.

Start simple: two different simple tips at the start of the game. Each tip cuts a different shape, for example a wide rounded trough versus a narrow flat groove.

More chisel shapes are bought later as progression, so the player starts with only one or two shapes and unlocks the rest.

### Dragging, speed, and depth

The player drags the chisel in from the bottom of the screen and into the spinning wood.

Cutting removes a little material on each moment of contact, with a cap on how much can come off in one pass. That creates the realistic behavior Brandon asked for:

- Drag too fast and the chisel stays mostly on the outside, scoring the surface and only slowly edging in
- Move slowly with pressure and the cut goes deeper
- No swipe cuts all the way through instantly, no matter how hard or fast the player drags
- Going deeper takes another pass, like real turning

Chips need to fly off while cutting, and the sound, shake, and wood grain all carry the feel.

### Engine note from the discussion

Three.js in the browser was the suggested fit in the conversation. Its LatheGeometry builds a spinning mesh from a profile line, and the mesh updates as that profile changes when the chisel cuts. It runs on phones in a browser, needs no app store install to playtest, and fits the browser-first distribution idea below.

## What you make

Not vases. Vases read as clay.

Turned wood pieces are things like:

- Banisters and spindles
- Funky walking sticks
- Bowls
- Chair legs
- Rolling pins
- Baseball bats

A funky walking stick is the right kind of mental image for the game: wooden, personal, a little odd, and something a player would actually want to make well.

## Commissions and grading

This is the mechanic that gives every piece a purpose.

Generate a design on the fly as a commission. The player turns, paints, and finishes a piece to match it, and the final creation is graded against the requested design for similarity. The closer they were to the requested commission, the more they get paid.

A commission specifies more than shape:

- The piece to make, and its target shape
- The specific type of wood it must be made from
- The painting it needs

That specificity is what makes the farm and the painting matter. Without it, any tree and any finish would do, and the rest of the loop would be decoration.

The lathe prototype idea already contains the seed of this system: a target shape to match, and a match percentage as the grade.

## The farm layer paces the whole game

Plant a tree of a certain type and wait for it to grow in real time, including while the game is closed.

Because commissions want specific types of wood, the player has to have the right tree grown and ready. That makes planting a real decision, not a side activity.

Buy more tiles of land for planting so more tree types can be growing at a time. More land means more types ready, which means more commissions can be taken, which means more money for more land and better tools.

The farm is the come back later hook. The lathe is the right now fun.

## Painting on the lathe

Painting is part of the commission, and painting on a lathe should be fun in itself.

Hold a brush or applicator to the spinning piece and the color goes on smooth and even as it turns. Stripes, gradients, and clean bands of color all fall out of painting a spinning object.

It is a second feel moment using the same spinning piece, with a different tool and a different result.

## Finish with a sheen

Last step before a piece is done: put a sheen on it with a spray bottle.

Spray the finish onto the piece, and a light source shines on it so the gloss shows. The light is what sells the finish: a matte piece looks flat, a finished piece catches the light as it turns.

Shape, wood, paint, and sheen together are what the commission grade and the shop price should reflect.

## Progression and the shop

Money from sold pieces and completed commissions buys:

- New chisel shapes, beyond the one or two the player starts with
- New wood and sapling types to plant
- More tiles of land, so more tree types can grow at once

Selling pieces in your own shop is the non-commission route: make something, finish it well, and sell it.

## Monetization ideas, both on the table

Two different ideas came up in the same conversation, and they are alternatives to decide between, not a combined plan.

### Premium idea

Charge $5 and sell 1,000 copies as the first validation test.

In Brandon's words, people like unique cozy niche stuff. A browser version for free sharing and a paid version on the Play Store and Steam as a possible sleeper indie hit were both discussed.

### Evil freemium idea

Lean into freemium, in Brandon's joking framing, and do it honestly:

- Diamonds speed up actions and unlock things faster
- Diamonds can instantly grow a tree instead of waiting, the classic whip out the credit card shortcut
- A mine where the player can watch an ad to go mining and mine a few diamonds

The waiting created by real-time tree growth is what gives diamonds something real to skip. The rule that keeps it fun is that diamonds are a shortcut, not the only way through.

## Distribution is browser first

Word of mouth is the plan, and browser play is what makes it frictionless.

If it is just play in the browser, anyone who sees a link is one tap from playing: no install, no store, no payment up front. Brandon's mom and Cassie's mom sharing it on Facebook was the concrete example, and that audience is exactly the audience for a cozy, satisfying game.

What gets shared is the clip: a short video of the tree cracking and falling, and the lathe cutting a clean shape into spinning wood, is the thing people pass around.

## The one-month bet and the dream factory

This is Brandon's own framing of why the game matters beyond the game.

Build it in a month. It is first thought material, so the test is simple: if the first idea makes what Brandon makes in a month at Walmart, in a month, then quit, cash out the roughly $4k in stocks, and take three months to really try building a business from it.

Trina would give her blessing to try three months off and come back if it fails, which makes it a test with a return path, not a leap with no net.

The reason to try, in Brandon's words: if he does not try, he will always subconsciously and unfairly resent his family and his job.

If weird niche stuff is validated once, the bigger idea behind it is an AI dream factory: a small operation making unique, cozy, niche things people actually want, one validated product at a time.

A build note from the same night: Brandon has 5 Claude resets that stay if he upgrades, and was half thinking of going absolutely HAM for a month with a Claude subscription. Even on Pro, Fable 5.2 plus those resets is a lot of building capacity for a one-month push, best spent on the prototype and build, not on the idea phase.

## Build order

1. Prototype the lathe first: log spinning, two tips, tap to switch tip, drag to cut, chips flying, fast drags staying shallow
2. Look at it and play it. If the turning does not look and feel good, stop and fix that before anything else
3. If it looks good, plan out the whole thing from this document

Prototype first, full plan second. That was the agreement on the night these ideas came up.
