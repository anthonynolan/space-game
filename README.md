# Starline Run

Starline Run is a fast side-scrolling spaceship game built with plain HTML, CSS, and JavaScript. Fly through a narrow asteroid corridor, dodge enemy fire, shoot aliens, bomb base stations, and survive long enough to claim a place on the local leaderboard.

## Local Play

Open `index.html` in a modern browser, or run a small static server from this directory:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## How To Start

1. Add a player name or select an existing player.
2. Press **Start** to launch a run.
3. Your score increases as you fly and jumps when you destroy enemies.

## Controls

### Touch Or Mouse

- Drag anywhere on the screen to steer the ship up or down.
- Use the on-screen laser button to fire at aliens.
- Use the on-screen bomb button to drop bombs on base stations.
- Use the pause button to pause or resume the run.

### Default Keyboard Controls

| Action | Default key |
| --- | --- |
| Steer up | Up Arrow |
| Steer down | Down Arrow |
| Speed up | Right Arrow |
| Slow down | Left Arrow |
| Fire laser | X |
| Drop bomb | Z |
| Pause / resume, or start from the menu | Space |

## Custom Keyboard Mappings

The start menu includes a **Keyboard** panel. To change a mapping:

1. Click the button beside the action you want to remap.
2. Press the key you want to use for that action.
3. The new mapping is saved in your browser automatically.

Use **Reset defaults** to restore the standard controls.

## Scoring And Enemies

- Flying farther continuously adds points.
- Destroying an alien with a laser awards **100 points**.
- Destroying a base station with a bomb awards **150 points**.
- Bonus point text appears beside each explosion briefly, then fades away.

## Survival Tips

- Keep the ship in the open tunnel between the ceiling and floor terrain.
- Aliens collide with you if they get too close, so fire early.
- Base stations shoot upward from the ground; drop bombs before they line up a shot.
- Use speed controls carefully: speeding up increases danger, while slowing down can help you recover.

## Deploy To AWS

The deployment uses:

- S3 for the game files
- CloudFront for HTTPS CDN hosting

Prerequisites:

- AWS CLI installed
- AWS credentials configured with access to upload to the S3 bucket and invalidate the CloudFront distribution
- An existing S3 bucket and CloudFront distribution

Deploy:

```bash
S3_BUCKET=game.cathalanddad.com CLOUDFRONT_DISTRIBUTION_ID=ABC123 ./scripts/deploy.sh
```

The script uploads `index.html`, `styles.css`, and `app.js`, then invalidates the CloudFront cache.

Optional overrides:

```bash
S3_BUCKET=game.cathalanddad.com CLOUDFRONT_DISTRIBUTION_ID=ABC123 SITE_URL=https://game.cathalanddad.com ./scripts/deploy.sh
```
