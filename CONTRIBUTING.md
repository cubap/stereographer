# Contributing

Thanks for contributing to Stereographer.

## Ways to Contribute

- Report bugs and usability issues
- Suggest improvements to viewer/editor workflows
- Submit fixes for IIIF parsing, crop handling, export/share features, and UI polish

## Before You Start

- Open an issue (or comment on an existing one) for non-trivial changes
- Keep PRs focused and reasonably small
- Include clear reproduction steps for bug fixes

## Development Notes

This project is a static web app (`index.html`, `app.js`, `styles.css`, plus viewer files).

- Keep changes framework-free unless discussed first
- Prefer readable, modern JavaScript
- Preserve existing behavior unless the change explicitly targets it

## Testing Checklist

Please verify at minimum:

- Load from `iiif-content` URL query parameter
- Crop box move/resize behavior (including both corner handles)
- Hash-based sharing (`#left=...&right=...`)
- Export actions (show/download/copy)
- RERUM (or other) save/update flow
- Viewer page behavior (`viewer.html`) on desktop and mobile

## Pull Requests

Include in your PR:

- What changed
- Why it changed
- How you tested it
- Screenshots or short recordings for UI changes

## Code Style

- Match existing formatting and naming in touched files
- Avoid unrelated refactors in the same PR
- Keep comments concise and only where needed

## Security & Data

- Do not commit secrets, tokens, or credentials
- Avoid logging sensitive data from user-provided IIIF resources

Thanks again for helping improve the tool.
