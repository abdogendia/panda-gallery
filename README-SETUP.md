# Panda Gallery — GitHub catalog + Cloudflare Worker (No database)

This version keeps the existing Panda Gallery storefront and Cloudinary image hosting. Products and categories are read from and written to `panda-bin.json` in your GitHub repository. The Cloudflare Worker acts as a secure API proxy; no D1 database and no JSONBin are used.

## Files
- `public/index.html` — updated storefront/admin panel; product/category changes are sent automatically to the Worker.
- `src/worker.js` — public catalog reader, server-side admin login, signed 8-hour session, and GitHub Contents API writer.
- `wrangler.toml` — Worker/static-assets config and non-secret GitHub repository settings.
- `panda-bin.json` — current catalog backup (12 categories, 16 products); preserve this file when placing the project in your repository.

## 1. Confirm repository settings
Edit `wrangler.toml`:
- `GITHUB_OWNER`: your GitHub username or organization.
- `GITHUB_REPO`: exact repository name.
- `GITHUB_BRANCH`: usually `main`.
- `CATALOG_PATH`: `panda-bin.json` if it is in the repository root.

## 2. Create a GitHub token
Create a fine-grained personal access token limited to this repository, with **Contents: Read and write** permission. Do not put the token in HTML, JavaScript, GitHub source, or any public file.

## 3. Set Cloudflare Worker secrets
From the project folder, run:

```bash
npm install
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

Paste the GitHub token for `GITHUB_TOKEN`. Choose a new strong admin password for `ADMIN_PASSWORD` (do not reuse any password/hash previously embedded in the old public HTML). For `SESSION_SECRET`, use a random value of at least 32 characters, e.g. generate one locally with `openssl rand -base64 48`.

## 4. Deploy to the existing Worker
Authenticate and deploy:

```bash
npx wrangler login
npx wrangler deploy
```

This package uses the Worker name `panda-gallery`. Check the existing Worker settings and route before deploying so you keep the current public URL/domain. If using GitHub-connected Workers Builds, configure the same build command and deploy from the repository instead of deploying locally.

## 5. Test before relying on it
1. Open `https://YOUR-WORKER-DOMAIN/api/health` and confirm `storage: "github"`.
2. Open `https://YOUR-WORKER-DOMAIN/api/catalog` and confirm products/categories are returned.
3. Log into the admin panel and add/edit a test product.
4. Confirm a new commit updates `panda-bin.json` in GitHub.
5. Open the site in a private/incognito window and confirm the new product appears.

## How it works
- Visitors load `panda-bin.json` through `GET /api/catalog`.
- Admin product/category changes call `PUT /api/admin/catalog` automatically.
- The Worker checks the admin session, fetches the latest GitHub file SHA, and commits the updated JSON with the GitHub Contents API.
- GitHub commit history provides catalog change history and rollback capability.
- Cloudinary image URLs remain in product data; images are not copied into GitHub.

## Security
- The old HTML contained a JSONBin Master Key. Revoke/rotate it in JSONBin after verifying that the GitHub-backed catalog works.
- Do not commit GitHub tokens, Cloudflare API tokens, `ADMIN_PASSWORD`, or `SESSION_SECRET`.
- Keep the GitHub token fine-grained and restricted to this one repository.
- The admin login endpoint should be protected with Cloudflare rate limiting to reduce password guessing.

## Existing data
The supplied `panda-bin.json` is retained as a backup and can be committed to the repository root. Existing Cloudinary image URLs are preserved.