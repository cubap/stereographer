// Overlay zoom state
let overlayZoom = 1
let overlayZoomOrigin = { x: 0.5, y: 0.5 }

function handleOverlayZoom(e) {
  e.preventDefault()
  const delta = e.deltaY < 0 ? 1.1 : 0.9
  const rect = overlayPreviewEl.getBoundingClientRect()
  // Mouse position relative to overlayPreviewEl
  const mx = (e.clientX - rect.left) / rect.width
  const my = (e.clientY - rect.top) / rect.height
  // Adjust zoom origin to mouse position
  overlayZoomOrigin = { x: mx, y: my }
  overlayZoom *= delta
  overlayZoom = Math.max(0.5, Math.min(overlayZoom, 5))
  syncOverlayZoom()
}

function syncOverlayZoom() {
  // Set transform on overlayPreviewEl to zoom and center on origin
  const originX = overlayZoomOrigin.x * 100
  const originY = overlayZoomOrigin.y * 100
  leftPreviewEl.style.transformOrigin =
    rightPreviewEl.style.transformOrigin = `${originX}% ${originY}%`
  leftPreviewEl.style.transform =
    rightPreviewEl.style.transform = `scale(${overlayZoom})`
}
const statusEl = document.getElementById("status")
const iiifInputEl = document.getElementById("iiifInput")
const pasteInputEl = document.getElementById("pasteInput")
const sourcePanelEl = document.getElementById("sourcePanel")
const overlayPanelEl = document.getElementById("overlayPanel")
const exportPanelEl = document.getElementById("exportPanel")
const sourcePreviewEl = document.getElementById("sourcePreview")
const sourceImageEl = document.getElementById("sourceImage")
const inputPanelEl = document.querySelector(".input-panel")
const leftBoxEl = document.getElementById("leftBox")
const rightBoxEl = document.getElementById("rightBox")
const overlayPreviewEl = document.getElementById("overlayPreview")
const leftPreviewEl = document.getElementById("leftPreview")
const rightPreviewEl = document.getElementById("rightPreview")
const exportOutputEl = document.getElementById("exportOutput")
const cloverLinkRowEl = document.getElementById("cloverLinkRow")
const cloverLinkEl = document.getElementById("cloverLink")
const shareViewerLinkEl = document.getElementById("shareViewerLink")
const blendEl = document.getElementById("blend")
const blinkSpeedEl = document.getElementById("blinkSpeed")
const blendValueEl = document.getElementById("blendValue")
const blinkSpeedValueEl = document.getElementById("blinkSpeedValue")
const blinkToggleBtnEl = document.getElementById("blinkToggleBtn")
const fullColorToggleEl = document.getElementById("fullColorToggle")
const loadSpinnerEl = document.getElementById("loadSpinner")
const RERUM_API_BASE = "https://tinydev.rerum.io"
const STEREOGRAPHER_GENERATOR = "Stereographer"

const state = {
  loaded: null,
  sourceManifest: null,
  sourceCanvas: null,
  type: null,
  image: null,
  regionWidth: 1000,
  regionHeight: 1000,
  leftRegion: { x: 0, y: 0, w: 1000, h: 1000 },
  rightRegion: { x: 1000, y: 0, w: 1000, h: 1000 },
  imageReady: false,
  awaitingImage: false,
  blinkOn: false,
  blinkPreBlend: null,
  blinkPreFullColor: null,
  useImageApiSelector: false,
  blinkTimer: null,
  interaction: null,
  rerumMatch: {
    Manifest: null,
    Canvas: null
  }
}

init()

function init() {
  window.addEventListener("hashchange", hydrateFromHash)
  hydrateFromHash()
  sourceImageEl.addEventListener("load", handleSourceImageLoad)
  sourceImageEl.addEventListener("error", handleSourceImageError)
  window.addEventListener("resize", syncView)

  bindRegionInteraction(leftBoxEl, "left")
  bindRegionInteraction(rightBoxEl, "right")
  setImageReady(false)

  hydrateFromUrlParam()

  document.getElementById("loadBtn").addEventListener("click", onLoadInput)
  document.getElementById("parsePasteBtn").addEventListener("click", onParsePasted)

  document.getElementById("selectorMode").addEventListener("change", event => {
    state.useImageApiSelector = event.target.checked
    if (state.imageReady) showManifest()
  })

  blendEl.addEventListener("input", updateOverlayControls)
  blinkSpeedEl.addEventListener("input", updateControlValues)
  fullColorToggleEl.addEventListener("change", updatePreviewColorMode)

  blinkToggleBtnEl.addEventListener("click", toggleBlink)

  document.getElementById("showManifestBtn").addEventListener("click", showManifest)
  document.getElementById("downloadManifestBtn").addEventListener("click", downloadManifest)
  document.getElementById("copyIiifContentBtn").addEventListener("click", copyIiifContent)
  document.getElementById("saveRerumCanvasBtn").addEventListener("click", () => saveToRerum("Canvas"))
  document.getElementById("saveRerumManifestBtn").addEventListener("click", () => saveToRerum("Manifest"))

  document.addEventListener("keydown", event => {
    if (event.code === "Space" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
      event.preventDefault()
      if (state.imageReady) toggleBlink()
    }
  })

  overlayPreviewEl.addEventListener("wheel", handleOverlayZoom, { passive: false })
  updateControlValues()
  updateOverlayControls()
  updatePreviewColorMode()
  updateShareViewerLink()
}

function hydrateFromUrlParam() {
  const params = new URLSearchParams(window.location.search)
  const iiifContent = params.get("iiif-content")
  if (!iiifContent) return

  iiifInputEl.value = iiifContent
  updateShareViewerLink()
  onLoadInput()
}

function hydrateFromHash() {
  if (!location.hash) return

  const params = new URLSearchParams(location.hash.slice(1))
  const leftVals = params.get("left")?.split(",").map(Number)
  const rightVals = params.get("right")?.split(",").map(Number)

  if (leftVals?.length !== 4 || rightVals?.length !== 4) return
  if ([...leftVals, ...rightVals].some(value => Number.isNaN(value))) return

  state.regionWidth = leftVals[2]
  state.regionHeight = leftVals[3]
  state.leftRegion = { x: leftVals[0], y: leftVals[1], w: leftVals[2], h: leftVals[3] }
  state.rightRegion = { x: rightVals[0], y: rightVals[1], w: rightVals[2], h: rightVals[3] }

  if (state.image?.width && state.image?.height) {
    state.leftRegion = clampRegion(state.leftRegion, state.image.width, state.image.height, state.regionWidth, state.regionHeight)
    state.rightRegion = clampRegion(state.rightRegion, state.image.width, state.image.height, state.regionWidth, state.regionHeight)
  }

  syncView()
  updateShareViewerLink()
}

async function onLoadInput() {
  const raw = iiifInputEl.value.trim()
  if (!raw) {
    setStatus("Provide a URL or iiif-content value", true)
    return
  }

  try {
    stopBlink()
    setImageReady(false)
    setStatus("Loading IIIF resource...")
    setLoadSpinner(true)
    const resolved = decodeIiifContentIfNeeded(raw)
    const json = await fetchJson(resolved)
    initializeFromResource(json)
    setStatus("Resource parsed. Waiting for image...")
  } catch (err) {
    setStatus(`Load failed: ${err.message}`, true)
    setLoadSpinner(false)
  }
}

function onParsePasted() {
  try {
    stopBlink()
    setImageReady(false)
    const json = JSON.parse(pasteInputEl.value)
    initializeFromResource(json)
    setStatus("Parsed pasted JSON. Waiting for image...")
  } catch (err) {
    setStatus(`Invalid JSON: ${err.message}`, true)
  }
}

function initializeFromResource(resource) {
  state.loaded = resource
  state.type = getIiifType(resource)
  state.rerumMatch.Manifest = null
  state.rerumMatch.Canvas = null
  setCloverLink(null)
  const sourceRefs = resolveSourceRefs(resource)
  state.sourceManifest = sourceRefs.manifest
  state.sourceCanvas = sourceRefs.canvas

  const resolved = resolveImageSource(resource)
  if (!resolved?.id) {
    throw new Error("Could not find an image source from resource")
  }

  state.image = resolved
  state.awaitingImage = true
  sourceImageEl.removeAttribute("src")
  sourceImageEl.src = resolved.id
  syncPreviewSource(resolved.id)

  const imageWidth = resolved.width ?? sourceImageEl.naturalWidth ?? 2000
  const imageHeight = resolved.height ?? sourceImageEl.naturalHeight ?? 2000
  setCenteredRegions(imageWidth, imageHeight)
  hydrateFromHash()
  updateShareViewerLink()
}

function resolveSourceRefs(resource) {
  const type = getIiifType(resource)

  if (type === "Manifest") {
    return {
      manifest: resource,
      canvas: resource.items?.[0] ?? resource.sequences?.[0]?.canvases?.[0] ?? null
    }
  }

  if (type === "Canvas") {
    return { manifest: null, canvas: resource }
  }

  return { manifest: null, canvas: null }
}

function updateOverlayControls() {
  const blend = Number(blendEl.value) / 100

  updateControlValues()

  rightPreviewEl.style.opacity = String(blend)
  rightPreviewEl.style.transform = "none"
}

function updateControlValues() {
  blendValueEl.value = blendEl.value
  blinkSpeedValueEl.value = blinkSpeedEl.value
}

function updatePreviewColorMode() {
  const fullColor = fullColorToggleEl.checked
  overlayPreviewEl.classList.toggle("full-color", fullColor)
  overlayPreviewEl.classList.toggle("anaglyph-mode", !fullColor)
  syncOverlayZoom()
}

function setLoadSpinner(visible) {
  if (!loadSpinnerEl) return
  loadSpinnerEl.hidden = !visible
}

function setImageReady(isReady) {
  state.imageReady = isReady
  if (isReady) setLoadSpinner(false)
  const reveals = [
    { panel: sourcePanelEl, delay: "0ms" },
    { panel: overlayPanelEl, delay: "180ms" },
    { panel: exportPanelEl, delay: "270ms" }
  ]

  for (const { panel, delay } of reveals) {
    panel.hidden = !isReady
    if (!isReady) {
      panel.classList.remove("panel-enter", "is-visible")
      panel.style.removeProperty("--enter-delay")
      continue
    }

    panel.classList.add("panel-enter")
    panel.style.setProperty("--enter-delay", delay)
    requestAnimationFrame(() => panel.classList.add("is-visible"))
  }

  document.body.classList.toggle("app-ready", isReady)
  inputPanelEl?.classList.toggle("is-collapsed", isReady)
  inputPanelEl?.setAttribute("aria-hidden", String(isReady))
}

async function handleSourceImageLoad() {
  if (!state.image?.id || !state.awaitingImage) return

  state.awaitingImage = false

  const imageWidth = sourceImageEl.naturalWidth || state.image.width
  const imageHeight = sourceImageEl.naturalHeight || state.image.height

  if (imageWidth && imageHeight) {
    state.image.width = imageWidth
    state.image.height = imageHeight
  }

  if (!state.leftRegion?.w || !state.rightRegion?.w) {
    setCenteredRegions(imageWidth, imageHeight)
  }

  applyMedianBackgroundFromSource()

  setImageReady(true)
  syncView()

  if (!location.hash) {
    await hydrateFromExistingRerumMatch()
  }

  setStatus("Loaded")
}

function handleSourceImageError() {
  state.awaitingImage = false
  setImageReady(false)
  setLoadSpinner(false)
  setStatus("Image could not be displayed (CORS or source issue)", true)
}

function syncPreviewSource(sourceUrl) {
  const url = `url("${sourceUrl}")`
  leftPreviewEl.style.backgroundImage = url
  rightPreviewEl.style.backgroundImage = url
}

function applyMedianBackgroundFromSource() {
  const width = sourceImageEl.naturalWidth
  const height = sourceImageEl.naturalHeight
  if (!width || !height) return

  try {
    const sampleSize = 64
    const canvas = document.createElement("canvas")
    canvas.width = sampleSize
    canvas.height = sampleSize
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return

    ctx.drawImage(sourceImageEl, 0, 0, sampleSize, sampleSize)
    const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data

    const rHist = new Uint32Array(256)
    const gHist = new Uint32Array(256)
    const bHist = new Uint32Array(256)
    let count = 0

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]
      if (alpha < 8) continue
      rHist[data[i]]++
      gHist[data[i + 1]]++
      bHist[data[i + 2]]++
      count++
    }

    if (!count) return

    const medianRgb = [medianFromHistogram(rHist, count), medianFromHistogram(gHist, count), medianFromHistogram(bHist, count)]
    document.documentElement.style.setProperty("--image-median-rgb", medianRgb.join(", "))
  } catch {
    // Ignore tainted canvas failures from strict CORS sources.
  }
}

function medianFromHistogram(hist, count) {
  const midpoint = Math.floor(count / 2)
  let running = 0

  for (let i = 0; i < hist.length; i++) {
    running += hist[i]
    if (running >= midpoint) return i
  }

  return 128
}

function setCenteredRegions(imageWidth, imageHeight) {
  // Always leave 10% padding on all sides for initial region
  const PADDING_PCT = 10
  const maxWidth = Math.max(48, Math.floor((imageWidth / 100 * (100 - PADDING_PCT * 3)) / 2))
  const maxHeight = Math.max(48, imageHeight / 100 * (100 - PADDING_PCT * 2))
  const width = clamp(maxWidth, 48, imageWidth / 100 * (100 - PADDING_PCT * 2))
  const height = clamp(maxHeight, 48, imageHeight / 100 * (100 - PADDING_PCT * 2))
  state.regionWidth = width
  state.regionHeight = height

  // Always start left region at (PADDING_PCT, PADDING_PCT)
  const y = PADDING_PCT * imageHeight / 100
  const leftX = PADDING_PCT * imageWidth / 100
  const rightX = PADDING_PCT * imageWidth / 100 + width + PADDING_PCT * imageWidth / 100

  state.leftRegion = clampRegion({
    x: leftX,
    y,
    w: width,
    h: height
  }, imageWidth, imageHeight, width, height)

  state.rightRegion = clampRegion({
    x: rightX,
    y,
    w: width,
    h: height
  }, imageWidth, imageHeight, width, height)
}

function bindRegionInteraction(boxEl, regionKey) {
  boxEl.addEventListener("pointerdown", event => {
    if (event.button !== 0) return
    const handleEl = event.target.closest(".resize-handle")
    if (!handleEl) {
      beginRegionInteraction(regionKey, "move", event)
      return
    }

    const resizeMode = handleEl.classList.contains("resize-handle-top-left") ? "resize-top-left" : "resize-bottom-right"
    beginRegionInteraction(regionKey, resizeMode, event)
  })
}

function beginRegionInteraction(regionKey, mode, event) {
  if (!state.image?.width || !state.image?.height) return

  event.preventDefault()
  const bounds = getSourceImageBounds()
  if (!bounds) return

  state.interaction = {
    regionKey,
    mode,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startRegion: { ...state[`${regionKey}Region`] },
    startLeftRegion: { ...state.leftRegion },
    startRightRegion: { ...state.rightRegion },
    scale: bounds.scale,
    imageWidth: bounds.imageWidth,
    imageHeight: bounds.imageHeight
  }

  window.addEventListener("pointermove", handleRegionPointerMove)
  window.addEventListener("pointerup", endRegionInteraction)
  window.addEventListener("pointercancel", endRegionInteraction)
}

function handleRegionPointerMove(event) {
  const interaction = state.interaction
  if (!interaction || event.pointerId !== interaction.pointerId) return

  const deltaX = (event.clientX - interaction.startX) / interaction.scale
  const deltaY = (event.clientY - interaction.startY) / interaction.scale
  const otherKey = interaction.regionKey === "left" ? "right" : "left"

  if (interaction.mode === "resize-bottom-right" || interaction.mode === "resize-top-left") {
    const isTopLeftResize = interaction.mode === "resize-top-left"
    const widthDelta = isTopLeftResize ? -deltaX : deltaX
    const heightDelta = isTopLeftResize ? -deltaY : deltaY

    const nextWidth = clamp(Math.round(interaction.startRegion.w + widthDelta), 48, interaction.imageWidth)
    const nextHeight = clamp(Math.round(interaction.startRegion.h + heightDelta), 48, interaction.imageHeight)
    const anchorDeltaX = isTopLeftResize ? interaction.startRegion.w - nextWidth : 0
    const anchorDeltaY = isTopLeftResize ? interaction.startRegion.h - nextHeight : 0

    state.regionWidth = nextWidth
    state.regionHeight = nextHeight

    state.leftRegion = clampRegion({
      x: interaction.startLeftRegion.x + anchorDeltaX,
      y: interaction.startLeftRegion.y + anchorDeltaY,
      w: nextWidth,
      h: nextHeight
    }, interaction.imageWidth, interaction.imageHeight, nextWidth, nextHeight)

    state.rightRegion = clampRegion({
      x: interaction.startRightRegion.x + anchorDeltaX,
      y: interaction.startRightRegion.y + anchorDeltaY,
      w: nextWidth,
      h: nextHeight
    }, interaction.imageWidth, interaction.imageHeight, nextWidth, nextHeight)
  } else {
    const nextRegion = clampRegion({
      x: interaction.startRegion.x + deltaX,
      y: interaction.startRegion.y + deltaY,
      w: state.regionWidth,
      h: state.regionHeight
    }, interaction.imageWidth, interaction.imageHeight, state.regionWidth, state.regionHeight)

    state[`${interaction.regionKey}Region`] = nextRegion
  }

  lockRegionOrder(interaction.regionKey, otherKey, interaction.imageWidth, interaction.imageHeight)
  syncView()
}

function endRegionInteraction(event) {
  if (state.interaction && event.pointerId !== state.interaction.pointerId) return

  state.interaction = null
  window.removeEventListener("pointermove", handleRegionPointerMove)
  window.removeEventListener("pointerup", endRegionInteraction)
  window.removeEventListener("pointercancel", endRegionInteraction)
  updateCropHash()
}

function updateCropHash() {
  const l = state.leftRegion
  const r = state.rightRegion
  if (!l || !r) return

  const hash = `left=${Math.round(l.x)},${Math.round(l.y)},${Math.round(l.w)},${Math.round(l.h)}&right=${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`
  if (location.hash.slice(1) === hash) return

  history.replaceState(null, "", `${location.pathname}${location.search}#${hash}`)
  updateShareViewerLink()
}

function updateShareViewerLink() {
  if (!shareViewerLinkEl) return

  const params = new URLSearchParams(window.location.search)
  const content = iiifInputEl?.value?.trim() || params.get("iiif-content")

  if (content) {
    params.set("iiif-content", content)
  } else {
    params.delete("iiif-content")
  }

  const query = params.toString()
  shareViewerLinkEl.href = `./viewer.html${query ? `?${query}` : ""}${window.location.hash || ""}`
}

function syncView() {
  syncSourceRegions()
  syncCropPreviews()
}

function syncSourceRegions() {
  const bounds = getSourceImageBounds()
  if (!bounds) return

  applyRegionBox(leftBoxEl, state.leftRegion, bounds)
  applyRegionBox(rightBoxEl, state.rightRegion, bounds)
}

function syncCropPreviews() {
  if (!state.image?.id || !state.image?.width || !state.image?.height) return

  applyCropPreview(leftPreviewEl, state.leftRegion, state.image.width, state.image.height)
  applyCropPreview(rightPreviewEl, state.rightRegion, state.image.width, state.image.height)
}

function applyRegionBox(boxEl, region, bounds) {
  if (!boxEl || !region) return

  const left = bounds.left + region.x * bounds.scale
  const top = bounds.top + region.y * bounds.scale
  const width = region.w * bounds.scale
  const height = region.h * bounds.scale

  boxEl.style.left = `${left}px`
  boxEl.style.top = `${top}px`
  boxEl.style.width = `${width}px`
  boxEl.style.height = `${height}px`
  boxEl.style.transform = "none"
}

function applyCropPreview(previewEl, region, imageWidth, imageHeight) {
  if (!previewEl || !region) return

  previewEl.style.aspectRatio = `${region.w} / ${region.h}`
  // Use layout size (not transformed size) so zoom does not affect crop calculations.
  const previewWidth = previewEl.clientWidth || previewEl.offsetWidth || 1
  const previewHeight = previewEl.clientHeight || previewEl.offsetHeight || 1
  const scaleX = previewWidth / region.w
  const scaleY = previewHeight / region.h

  previewEl.style.backgroundImage = `url("${state.image.id}")`
  previewEl.style.backgroundRepeat = "no-repeat"
  previewEl.style.backgroundSize = `${imageWidth * scaleX}px ${imageHeight * scaleY}px`
  previewEl.style.backgroundPosition = `${-region.x * scaleX}px ${-region.y * scaleY}px`
}

function getSourceImageBounds() {
  const imageWidth = state.image?.width || sourceImageEl.naturalWidth
  const imageHeight = state.image?.height || sourceImageEl.naturalHeight
  const container = sourcePreviewEl.getBoundingClientRect()

  if (!imageWidth || !imageHeight || !container.width || !container.height) {
    return null
  }

  const scale = Math.min(container.width / imageWidth, container.height / imageHeight)
  const renderWidth = imageWidth * scale
  const renderHeight = imageHeight * scale

  return {
    imageWidth,
    imageHeight,
    scale,
    left: (container.width - renderWidth) / 2,
    top: (container.height - renderHeight) / 2
  }
}

function lockRegionOrder(activeKey, otherKey, imageWidth, imageHeight) {
  const activeRegion = state[`${activeKey}Region`]
  const otherRegion = state[`${otherKey}Region`]
  if (!activeRegion || !otherRegion) return

  const activeCenter = regionCenterX(activeRegion)
  const otherCenter = regionCenterX(otherRegion)

  if (activeKey === "left" && activeCenter > otherCenter) {
    state.leftRegion = centerRegion(otherCenter, regionCenterY(activeRegion), state.regionWidth, state.regionHeight, imageWidth, imageHeight)
  }

  if (activeKey === "right" && activeCenter < otherCenter) {
    state.rightRegion = centerRegion(otherCenter, regionCenterY(activeRegion), state.regionWidth, state.regionHeight, imageWidth, imageHeight)
  }
}

function clampRegion(region, imageWidth, imageHeight, width = state.regionWidth, height = state.regionHeight) {
  const boundedWidth = clamp(Math.round(width), 48, imageWidth)
  const boundedHeight = clamp(Math.round(height), 48, imageHeight)
  const x = clamp(Math.round(region.x), 0, imageWidth - boundedWidth)
  const y = clamp(Math.round(region.y), 0, imageHeight - boundedHeight)

  return {
    x,
    y,
    w: boundedWidth,
    h: boundedHeight
  }
}

function centerRegion(centerX, centerY, width, height, imageWidth, imageHeight) {
  const boundedWidth = clamp(Math.round(width), 48, imageWidth)
  const boundedHeight = clamp(Math.round(height), 48, imageHeight)
  const x = clamp(Math.round(centerX - boundedWidth / 2), 0, imageWidth - boundedWidth)
  const y = clamp(Math.round(centerY - boundedHeight / 2), 0, imageHeight - boundedHeight)
  return { x, y, w: boundedWidth, h: boundedHeight }
}

function regionCenterX(region) {
  return region.x + region.w / 2
}

function regionCenterY(region) {
  return region.y + region.h / 2
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function toggleBlink() {
  if (state.blinkOn) {
    stopBlink()
  } else {
    startBlink()
  }
}

function startBlink() {
  stopBlink()
  state.blinkPreBlend = blendEl.value
  state.blinkPreFullColor = fullColorToggleEl.checked

  blendEl.value = "100"
  fullColorToggleEl.checked = true
  updateOverlayControls()
  updatePreviewColorMode()

  const interval = Number(blinkSpeedEl.value)
  let on = true
  state.blinkTimer = setInterval(() => {
    on = !on
    rightPreviewEl.style.visibility = on ? "visible" : "hidden"
  }, interval)

  state.blinkOn = true
  blinkToggleBtnEl.setAttribute("aria-pressed", "true")
  blinkToggleBtnEl.innerHTML = "⏸"
}

function stopBlink() {
  if (state.blinkTimer) {
    clearInterval(state.blinkTimer)
    state.blinkTimer = null
  }

  if (state.blinkOn && state.blinkPreBlend !== null) {
    blendEl.value = state.blinkPreBlend
    fullColorToggleEl.checked = state.blinkPreFullColor
    updateOverlayControls()
    updatePreviewColorMode()
    state.blinkPreBlend = null
    state.blinkPreFullColor = null
  }

  state.blinkOn = false
  blinkToggleBtnEl.setAttribute("aria-pressed", "false")
  blinkToggleBtnEl.innerHTML = "&#9654;"
  rightPreviewEl.style.visibility = "visible"
}

function showManifest() {
  try {
    const manifest = buildCanvasOrManifest("Manifest")
    exportOutputEl.value = JSON.stringify(manifest, null, 2)
  } catch (err) {
    exportOutputEl.value = `Error: ${err.message}`
  }
}

function buildCanvasOrManifest(kind = "Manifest") {
  if (!state.image?.id) {
    throw new Error("No loaded image source to export")
  }

  const leftBody = buildPaintBody(state.leftRegion)
  const rightBody = buildPaintBody(state.rightRegion)

  const canvas = {
    id: "https://example.org/canvas/1",
    type: "Canvas",
    width: state.leftRegion.w,
    height: state.leftRegion.h,
    duration: 0.4,
    ...pickExportFields(state.sourceCanvas, ["label", "metadata", "summary", "description", "rights", "requiredStatement"]),
    items: [
      {
        id: "https://example.org/page/1",
        type: "AnnotationPage",
        items: [
          {
            id: "https://example.org/anno/left",
            type: "Annotation",
            motivation: "painting",
            body: leftBody,
            target: "https://example.org/canvas/1#t=0,0.2"
          },
          {
            id: "https://example.org/anno/right",
            type: "Annotation",
            motivation: "painting",
            body: rightBody,
            target: "https://example.org/canvas/1#t=0.2,0.4"
          }
        ]
      }
    ]
  }

  const taggedCanvas = addStereographerMetadata(canvas, "Canvas")
  if (kind === "Canvas") return taggedCanvas

  const manifestSource = state.sourceManifest ?? state.sourceCanvas

  const manifest = {
    "@context": "http://iiif.io/api/presentation/3/context.json",
    id: "https://example.org/manifest/1",
    type: "Manifest",
    label: normalizeIiifLabel(manifestSource?.label) ?? { en: ["Stereogram Draft"] },
    ...pickExportFields(manifestSource, ["metadata", "summary", "description", "rights", "requiredStatement"]),
    items: [taggedCanvas]
  }

  return addStereographerMetadata(manifest, "Manifest")
}

function pickExportFields(source, keys) {
  if (!source || typeof source !== "object") return {}

  const picked = {}
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined && value !== null) {
      picked[key] = value
    }
  }

  if (!picked.summary && source.description) {
    picked.summary = normalizeIiifLabel(source.description)
  }

  return picked
}

function normalizeIiifLabel(value) {
  if (!value) return null
  if (typeof value === "string") return { en: [value] }
  if (Array.isArray(value)) return { en: value.map(String) }
  return value
}

function buildPaintBody(region) {
  if (state.useImageApiSelector) {
    return {
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
        region: `${region.x},${region.y},${region.w},${region.h}`
      }
    }
  }

  return {
    id: toRegionUrl(state.image.id, region),
    type: "Image",
    format: "image/jpeg",
    width: region.w,
    height: region.h
  }
}

function downloadManifest() {
  try {
    setCloverLink(null)
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
    setCloverLink(null)
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
    setCloverLink(null)
    const payload = buildCanvasOrManifest(kind)
    const json = await upsertRerum(kind, payload)
    const savedId = getIiifId(json)
    state.rerumMatch[kind] = savedId ?? state.rerumMatch[kind]
    if (kind === "Manifest" && savedId) {
      const cloverUrl = buildCloverViewerUrl(savedId)
      setCloverLink(cloverUrl)
      exportOutputEl.value = JSON.stringify(json, null, 2)
      setStatus(`Saved ${kind} to RERUM. Clover link is available in Export.`)
    } else {
      exportOutputEl.value = JSON.stringify(json, null, 2)
      setStatus(`Saved ${kind} to RERUM`)
    }
  } catch (err) {
    setStatus(`RERUM save failed: ${err.message}`, true)
  }
}

function buildCloverViewerUrl(manifestUrl) {
  return `https://samvera-labs.github.io/clover-iiif/?iiif-content=${encodeURIComponent(manifestUrl)}`
}

function addStereographerMetadata(resource, kind) {
  if (!resource || typeof resource !== "object") return resource

  const existingMetadata = resource.metadata ?? []
  const markerLabel = "Generated by"
  const markerValue = STEREOGRAPHER_GENERATOR
  const hasMarker = existingMetadata.some?.(entry => {
    const label = entry?.label?.en?.[0] ?? entry?.label ?? ""
    const value = entry?.value?.en?.[0] ?? entry?.value ?? ""
    return String(label).toLowerCase() === markerLabel.toLowerCase() && String(value).includes(markerValue)
  })

  const metadata = hasMarker
    ? existingMetadata
    : [...existingMetadata, { label: { en: [markerLabel] }, value: { en: [markerValue] } }]

  return {
    ...resource,
    metadata,
    stereographer: {
      generatedBy: STEREOGRAPHER_GENERATOR,
      kind,
      sourceImageId: state.image?.id ?? null,
      sourceResourceId: getIiifId(state.sourceManifest ?? state.sourceCanvas ?? state.loaded)
    }
  }
}

async function upsertRerum(kind, payload) {
  const existingId = state.rerumMatch[kind]

  if (existingId) {
    const updatePayload = {
      ...payload,
      id: existingId,
      "@id": existingId
    }

    const updateResponse = await fetch(`${RERUM_API_BASE}/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(updatePayload)
    })

    if (updateResponse.ok) {
      return updateResponse.json()
    }
  }

  const createResponse = await fetch(`${RERUM_API_BASE}/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  })

  if (!createResponse.ok) {
    throw new Error(`RERUM responded ${createResponse.status}`)
  }

  return createResponse.json()
}

async function hydrateFromExistingRerumMatch() {
  if (!state.image?.id) return

  try {
    const results = await queryRerumStereographerRecords(state.image.id)
    if (!results.length) return

    const manifestMatch = results.find(item => getIiifType(item) === "Manifest") ?? null
    const canvasMatch = results.find(item => getIiifType(item) === "Canvas") ?? null
    state.rerumMatch.Manifest = getIiifId(manifestMatch)
    state.rerumMatch.Canvas = getIiifId(canvasMatch)

    const chosen = manifestMatch ?? canvasMatch
    const regions = extractRegionsFromResource(chosen)
    if (!regions) return

    const imageWidth = state.image.width || sourceImageEl.naturalWidth
    const imageHeight = state.image.height || sourceImageEl.naturalHeight
    if (!imageWidth || !imageHeight) return

    state.regionWidth = regions.left.w
    state.regionHeight = regions.left.h
    state.leftRegion = clampRegion(regions.left, imageWidth, imageHeight, state.regionWidth, state.regionHeight)
    state.rightRegion = clampRegion(regions.right, imageWidth, imageHeight, state.regionWidth, state.regionHeight)
    syncView()
    updateCropHash()

    if (state.rerumMatch.Manifest) {
      setCloverLink(buildCloverViewerUrl(state.rerumMatch.Manifest))
    }
  } catch {
    // Ignore lookup failures and keep centered defaults.
  }
}

async function queryRerumStereographerRecords(sourceImageId) {
  const query = {
    "$and": [
      { "stereographer.generatedBy": STEREOGRAPHER_GENERATOR },
      { "stereographer.sourceImageId": sourceImageId }
    ]
  }

  const response = await fetch(`${RERUM_API_BASE}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(query)
  })

  if (!response.ok) return []

  const payload = await response.json()
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.results)) return payload.results
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

function extractRegionsFromResource(resource) {
  if (!resource || typeof resource !== "object") return null

  const type = getIiifType(resource)
  const canvas = type === "Manifest"
    ? resource.items?.[0] ?? resource.sequences?.[0]?.canvases?.[0]
    : resource

  if (!canvas || getIiifType(canvas) !== "Canvas") return null

  const annotations = canvas.items?.[0]?.items
  if (!Array.isArray(annotations) || annotations.length < 2) return null

  const left = parseRegionFromBody(annotations[0]?.body ?? annotations[0]?.resource)
  const right = parseRegionFromBody(annotations[1]?.body ?? annotations[1]?.resource)
  if (!left || !right) return null

  return { left, right }
}

function parseRegionFromBody(body) {
  if (!body || typeof body !== "object") return null

  const bodyType = getIiifType(body)
  if (bodyType === "SpecificResource") {
    return parseRegionString(body.selector?.region)
  }

  if (bodyType !== "Image") return null

  const imageId = getIiifId(body)
  if (!imageId) return null

  try {
    const parsed = new URL(imageId)
    const segments = parsed.pathname.split("/")
    if (segments.length < 5) return null
    return parseRegionString(segments[segments.length - 4])
  } catch {
    return null
  }
}

function parseRegionString(value) {
  if (!value || typeof value !== "string") return null
  const parts = value.split(",").map(Number)
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null
  return {
    x: parts[0],
    y: parts[1],
    w: parts[2],
    h: parts[3]
  }
}

function setCloverLink(url) {
  if (!cloverLinkRowEl || !cloverLinkEl) return

  if (!url) {
    cloverLinkRowEl.hidden = true
    cloverLinkEl.removeAttribute("href")
    return
  }

  cloverLinkEl.href = url
  cloverLinkRowEl.hidden = false
}

function resolveImageSource(resource) {
  if (!resource || typeof resource !== "object") return null

  const type = getIiifType(resource)

  if (type === "Image") {
    return {
      id: getIiifId(resource),
      width: resource.width,
      height: resource.height,
      service: normalizeService(resource.service)
    }
  }

  if (type === "Canvas") {
    const anno = resource.items?.[0]?.items?.[0] ?? resource.images?.[0]
    return resolveBodyToImage(anno?.body ?? anno?.resource)
  }

  if (type === "Manifest") {
    const canvas = resource.items?.[0] ?? resource.sequences?.[0]?.canvases?.[0]
    if (!canvas) return null
    return resolveImageSource(canvas)
  }

  return null
}

function resolveBodyToImage(body) {
  if (!body) return null

  const type = getIiifType(body)

  if (type === "Image") {
    return {
      id: getIiifId(body),
      width: body.width,
      height: body.height,
      service: normalizeService(body.service)
    }
  }

  if (type === "SpecificResource" && body.source) {
    return resolveBodyToImage(body.source)
  }

  return null
}

function normalizeService(service) {
  if (!service) return null
  if (Array.isArray(service)) return service[0]
  return service
}

function getIiifType(value) {
  const rawType = value?.type ?? value?.["@type"] ?? null
  if (!rawType) return null
  return rawType.includes(":") ? rawType.split(":").pop() : rawType
}

function getIiifId(value) {
  return value?.id ?? value?.["@id"] ?? null
}

function toRegionUrl(baseImageUrl, region) {
  const regionValue = `${region.x},${region.y},${region.w},${region.h}`

  try {
    const parsed = new URL(baseImageUrl)
    const segments = parsed.pathname.split("/")

    // IIIF Image API URL shape ends with: /{region}/{size}/{rotation}/{quality}
    if (segments.length < 5) return baseImageUrl

    const regionIndex = segments.length - 4
    if (regionIndex < 1) return baseImageUrl

    segments[regionIndex] = regionValue
    parsed.pathname = segments.join("/")
    return parsed.toString()
  } catch {
    return baseImageUrl
  }
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
