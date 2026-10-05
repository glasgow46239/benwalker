# Personal site (Cloudflare Pages)

```
public/            static site (index.html, styles.css, main.js, favicon.svg)
public/site.config.json   ← edit this: projects, social links, feeds, contact key
functions/api/feed.js     Pages Function: merges your RSS/Atom feeds → /api/feed (cached 30 min)
wrangler.toml
```

## 1. Fill in your details
- **index.html** – name, headline, intro text, page title/description.
- **public/site.config.json**
  - `feeds` – your Substack feed (`https://NAME.substack.com/feed`) and your magazine author-page RSS/Atom URL. Any number of feeds; each gets a filter chip.
  - `sites` – the project cards (title, description, url, tag).
  - `social` – links shown under the intro.
  - `contact.accessKey` – see step 2.

## 2. Contact form (Web3Forms, free)
1. Go to web3forms.com, enter the email address messages should go to, and copy the access key.
2. Paste it into `contact.accessKey`. The key is designed to be public; it only lets people send *to* you.
3. Spam: there's a honeypot built in. For more protection, enable hCaptcha in the Web3Forms dashboard.
(Prefer Formspree? Change `endpoint` to your Formspree URL; it accepts the same JSON.)

## 3. Deploy
**Via Git (easiest):** push this folder to a GitHub repo → Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git. Build command: *none*. Output directory: `public`.

**Or via CLI:** `npx wrangler pages deploy` from this folder.

## 4. Point your domain at it
Pages project → Custom domains → Set up a domain. If the domain's DNS is already on Cloudflare it's one click; otherwise add the CNAME it shows you at your registrar (or move nameservers to Cloudflare).

## Local preview
`npx wrangler pages dev` → http://localhost:8788 (the feed function runs locally too).
