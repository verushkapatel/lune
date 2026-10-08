# The Skyward Project website

A static single-page site for theskywardproject.com. No build step.

- `index.html`: content and structure
- `styles.css`: black and navy theme
- `app.js`: logo loader, demos and the Field notes story
- `assets/`: logo, icons, share image, team photos

To deploy, upload the contents of this folder to the site root. To preview:

```bash
cd skyward && python3 -m http.server 8000
```

The contact form posts to Web3Forms with the existing access key.
