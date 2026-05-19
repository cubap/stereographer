const statusEl = document.getElementById("status")
const iiifInputEl = document.getElementById("iiifInput")
const pasteInputEl = document.getElementById("pasteInput")
const sourceImageEl = document.getElementById("sourceImage")
const leftPreviewEl = document.getElementById("leftPreview")
const rightPreviewEl = document.getElementById("rightPreview")
const exportOutputEl = document.getElementById("exportOutput")

const state = {
  loaded: null,
  type: null,
  image: null,
  leftRegion: { x: 0, y: 0, w: 1000, h: 1000 },
  rightRegion: { x: 1000, y: 0, w: 1000, h: 1000 },
  useImageApiSelector: false,
  blinkTimer: null
}

init()

function init() {
  hydrateFromUrlParam()

  document.getElementById("loadBtn").addEventListener("click", onLoadInput)
  document.getElementById("parsePasteBtn").addEventListener("click", onParsePasted)

  document.getElementById("selectorMode").addEventListener("change", event => {
    state.useImageApiSelector = event.target.checked
  })

  document.getElementById("blend").addEventListener("input", updateOverlayControls)
  document.getElementById("nudgeX").addEventListener("input", updateOverlayControls)
  document.getElementById("nudgeY").addEventListener("input", updateOverlayControls)

  document.getElementById("blinkStartBtn").addEventListener("click", startBlink)
  document.getElementById("blinkStopBtn").addEventListener("click", stopBlink)

  document.getElementById("downloadManifestBtn").addEventListener("click", downloadManifest)
  document.getElementById("copyIiifContentBtn").addEventListener("click", copyIiifContent)
  document.getElementById("saveRerumCanvasBtn").addEventListener("click", () => saveToRerum("Canvas"))
  document.getElementById("saveRerumManifestBtn").addEventListener("click", () => saveToRerum("Manifest"))
}

function hydrateFromUrlParam() {
  const params = new URLSearchParams(window.location.search)
  const iiifContent = params.get("iiif-content")
  if (!iiifContent) return

  iiifInputEl.value = iiifContent
  onLoadInput()
}

async function onLoadInput() {
  const raw = iiifInputEl.value.trim()
  if (!raw) {
    setStatus("Provide a URL or iiif-content value", true)
    return
  }

  try {
    setStatus("Loading IIIF resource...")
    const resolved = decodeIiifContentIfNeeded(raw)
    const json = await fetchJson(resolved)
    initializeFromResource(json)
    setStatus("Loaded")
  } catch (err) {
    setStatus(`Load failed: ${err.message}`, true)
  }
}

function onParsePasted() {
  try {
    const json = JSON.parse(pasteInputEl.value)
    initializeFromResource(json)
    setStatus("Loaded from pasted JSON")
  } catch (err) {
    setStatus(`Invalid JSON: ${err.message}`, true)
  }
}

function initializeFromResource(resource) {
  state.loaded = resource
  state.type = resource.type

  const resolved = resolveImageSource(resource)
  if (!resolved?.id) {
    throw new Error("Could not find an image source from resource")
  }

  state.image = resolved
  sourceImageEl.src = resolved.id
  leftPreviewEl.src = resolved.id
  rightPreviewEl.src = resolved.id

  state.leftRegion = {
    x: 0,
    y: 0,
    w: Math.floor((resolved.width ?? 2000) / 2),
    h: resolved.height ?? 2000
  }

  state.rightRegion = {
    x: Math.floor((resolved.width ?? 2000) / 2),
    y: 0,
    w: Math.floor((resolved.width ?? 2000) / 2),
    h: resolved.height ?? 2000
  }

  exportOutputEl.value = "Resource loaded. Next: wire draggable crop boxes to region state."
}

function updateOverlayControls() {
  const blend = Number(document.getElementById("blend").value) / 100
  const nudgeX = Number(document.getElementById("nudgeX").value)
  const nudgeY = Number(document.getElementById("nudgeY").value)

  rightPreviewEl.style.opacity = String(blend)
  rightPreviewEl.style.transform = `translate(${nudgeX}px, ${nudgeY}px)`
}

function startBlink() {
  stopBlink()
  const interval = Number(document.getElementById("blinkSpeed").value)
  let on = true
  state.blinkTimer = setInterval(() => {
    on = !on
    rightPreviewEl.style.visibility = on ? "visible" : "hidden"
  }, interval)
}

function stopBlink() {
  if (state.blinkTimer) {
    clearInterval(state.blinkTimer)
    state.blinkTimer = null
  }
  rightPreviewEl.style.visibility = "visible"
}

function buildCanvasOrManifest(kind = "Manifest") {
  if (!state.image?.id) {
    throw new Error("No loaded image source to export")
  }

  const body = state.useImageApiSelector
    ? {
        type: "SpecificResource",
        source: {
          id: state.image.id,
          type: "Image",
          format: "image/jpeg",
          width: state.image.width,
          height: state.image.height,
          service: state.image.service ? [state.image.service] : undefined
        },
        selector: {
          type: "ImageApiSelector",
          region: `${state.leftRegion.x},${state.leftRegion.y},${state.leftRegion.w},${state.leftRegion.h}`
        }
      }
    : {
        id: toRegionUrl(state.image.id, state.leftRegion),
        type: "Image",
        format: "image/jpeg",
        width: state.leftRegion.w,
        height: state.leftRegion.h
      }

  const canvas = {
    id: "https://example.org/canvas/1",
    type: "Canvas",
    width: state.leftRegion.w,
    height: state.leftRegion.h,
    duration: 0.4,
    items: [
      {
        id: "https://example.org/page/1",
        type: "AnnotationPage",
        items: [
          {
            id: "https://example.org/anno/left",
            type: "Annotation",
            motivation: "painting",
            body,
            target: "https://example.org/canvas/1#t=0,0.2"
          }
        ]
      }
    ]
  }

  if (kind === "Canvas") return canvas

  return {
    "@context": "http://iiif.io/api/presentation/3/context.json",
    id: "https://example.org/manifest/1",
    type: "Manifest",
    label: { en: ["Stereogram Draft"] },
    items: [canvas]
  }
}

function downloadManifest() {
  try {
    const json = buildCanvasOrManifest("Manifest")
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "stereogram-manifest.json"
    a.click()
    URL.revokeObjectURL(url)
    setStatus("Manifest downloaded")
  } catch (err) {
    setStatus(`Export failed: ${err.message}`, true)
  }
}

async function copyIiifContent() {
  try {
    const manifest = buildCanvasOrManifest("Manifest")
    const encoded = toBase64Url(JSON.stringify(manifest))
    await navigator.clipboard.writeText(encoded)
    exportOutputEl.value = encoded
    setStatus("Base64url iiif-content copied")
  } catch (err) {
    setStatus(`Copy failed: ${err.message}`, true)
  }
}

async function saveToRerum(kind) {
  try {
    const payload = buildCanvasOrManifest(kind)
    const response = await fetch("https://tinydev.rerum.io/app/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      throw new Error(`RERUM responded ${response.status}`)
    }

    const json = await response.json()
    exportOutputEl.value = JSON.stringify(json, null, 2)
    setStatus(`Saved ${kind} to RERUM`)
  } catch (err) {
    setStatus(`RERUM save failed: ${err.message}`, true)
  }
}

function resolveImageSource(resource) {
  if (!resource || typeof resource !== "object") return null

  if (resource.type === "Image") {
    return {
      id: resource.id,
      width: resource.width,
      height: resource.height,
      service: normalizeService(resource.service)
    }
  }

  if (resource.type === "Canvas") {
    const anno = resource.items?.[0]?.items?.[0]
    return resolveBodyToImage(anno?.body)
  }

  if (resource.type === "Manifest") {
    const canvas = resource.items?.[0]
    if (!canvas) return null
    return resolveImageSource(canvas)
  }

  return null
}

function resolveBodyToImage(body) {
  if (!body) return null

  if (body.type === "Image") {
    return {
      id: body.id,
      width: body.width,
      height: body.height,
      service: normalizeService(body.service)
    }
  }

  if (body.type === "SpecificResource" && body.source) {
    return resolveBodyToImage(body.source)
  }

  return null
}

function normalizeService(service) {
  if (!service) return null
  if (Array.isArray(service)) return service[0]
  return service
}

function toRegionUrl(baseImageUrl, region) {
  const fullMarker = "/full/"
  if (!baseImageUrl.includes(fullMarker)) return baseImageUrl
  const [prefix, rest] = baseImageUrl.split(fullMarker)
  return `${prefix}/${region.x},${region.y},${region.w},${region.h}/full/${rest}`
}

function decodeIiifContentIfNeeded(raw) {
  const maybeUrl = safeUrl(raw)
  if (maybeUrl) {
    const p = new URL(maybeUrl)
    const embedded = p.searchParams.get("iiif-content")
    if (embedded) {
      const decoded = tryDecodeBase64Url(embedded)
      if (decoded) {
        const maybe = tryParseJson(decoded)
        if (maybe?.id) return maybe.id
      }
      return embedded
    }
    return raw
  }

  const decoded = tryDecodeBase64Url(raw)
  if (decoded) {
    const maybe = tryParseJson(decoded)
    if (maybe?.id) return maybe.id
  }

  return raw
}

function safeUrl(value) {
  try {
    return new URL(value).toString()
  } catch {
    return null
  }
}

function tryDecodeBase64Url(value) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized + "===".slice((normalized.length + 3) % 4)
    return atob(padded)
  } catch {
    return null
  }
}

function toBase64Url(text) {
  const b64 = btoa(text)
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function tryParseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json()
}

function setStatus(message, isError = false) {
  statusEl.textContent = message
  statusEl.style.color = isError ? "#a32b2b" : "#5b6e3a"
}
