## Starline Run

A browser game built with plain HTML, CSS, and JavaScript.

## Local Play

Open `index.html` in a browser, or run a small static server from this directory:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

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
