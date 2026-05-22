# Stereographer

Stereographer is a small browser-based IIIF tool for building and previewing stereoscopic image pairs.

It loads a IIIF Manifest, Canvas, `iiif-content` link, or direct image URL, lets you place left-eye and right-eye crop regions, and then helps you:

- preview the stereo pair as an anaglyph or flicker comparison
- export a generated IIIF Manifest or Canvas
- copy a base64url `iiif-content` payload for sharing
- save generated resources to RERUM
- open saved Manifests in external viewers such as Clover and David Newbury's Stereograph viewer

## What It Does

The editor is designed for quick stereographic drafting rather than full IIIF authoring.

- Load an existing IIIF resource or a source image.
- Adjust two crop boxes that represent the left-eye and right-eye views.
- Preview the result in-place.
- Export a derived IIIF resource that preserves the stereo pairing.

The included viewer page is a lightweight playback surface for shared `iiif-content` links.

## Export Notes

Stereographer can preview plain image URLs, but cropped IIIF export needs a source that is actually IIIF Image API-capable.

- If the source has a IIIF Image API service, you can enable `ImageApiSelector` mode.
- If the source URL already has IIIF Image API request shape, Stereographer can export cropped image bodies by rewriting the region segment.
- If the source is only a plain image URL, the app will still preview it but will refuse to generate misleading cropped IIIF output.

RERUM saving currently targets the `tinydev.rerum.io` sandbox.

## Development

This project is intentionally simple: static HTML, CSS, and browser-side JavaScript modules.

To run it locally, serve the repository with any static file server and open `index.html`.

## Acknowledgements

Stereographer was influenced by the excellent Stereograph viewer by David Newbury:

- https://stereograph.davidnewbury.com/

That work helped shape how this tool thinks about lightweight IIIF-based stereoscopic viewing, and the export panel includes a direct handoff link to that viewer when a Manifest URL is available.
