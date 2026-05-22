import { decodeIiifContentIfNeeded, fetchJson, getIiifId, getIiifType, isLikelyImageUrl, loadImageDimensions, parseHashRegions, parseRegionString, resolveImageSource } from "./iiif-utils.js"

const openEditorLinkEl = document.getElementById("openEditorLink")
const viewportEl = document.getElementById("viewerViewport")
const overlayEl = document.getElementById("viewerOverlay")
const overlayTextEl = document.getElementById("viewerOverlayText")
const overlayHelpEl = document.getElementById("viewerOverlayHelp")
const spinnerEl = document.getElementById("viewerSpinner")
const stageEl = document.getElementById("viewerStage")
const leftEl = document.getElementById("viewerLeft")
const rightEl = document.getElementById("viewerRight")

const speedEl = document.getElementById("viewerSpeed")
const speedValueEl = document.getElementById("viewerSpeedValue")
const toggleEl = document.getElementById("viewerToggle")
const zoomEl = document.getElementById("viewerZoom")
const resetViewBtnEl = document.getElementById("resetViewBtn")

const state = {
  image: null,
  left: null,
  right: null,
  baseScale: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
  drag: null,
  flickerOn: false,
  flickerTimer: null,
  rightVisible: true
}

init()

async function init() {
  updateEditorLink()
  bindControls()

  const iiifContent = new URLSearchParams(window.location.search).get("iiif-content")
  if (!iiifContent) {
    setStatus("Missing iiif-content in URL. Add ?iiif-content=... from the editor link.", true)
    return
  }

  try {
    setStatus("Loading IIIF resource...")
    const resolved = decodeIiifContentIfNeeded(iiifContent)
    let resource

    try {
      resource = await fetchJson(resolved)
    } catch (err) {
      if (!isLikelyImageUrl(resolved)) throw err

      resource = {
        id: resolved,
        type: "Image"
      }
    }

    const image = resolveStereographerSourceImage(resource) ?? resolveImageSource(resource)

    if (!image?.id) {
      throw new Error("Could not resolve an image source")
    }

    const dims = await loadImageDimensions(image.id)
    state.image = {
      ...image,
      width: image.width ?? dims.width,
      height: image.height ?? dims.height
    }

    const hashRegions = normalizeConfiguredRegions(
      parseHashRegions(window.location.hash),
      state.image.width,
      state.image.height
    )
    const embeddedRegions = normalizeConfiguredRegions(
      extractRegionsFromResource(resource),
      state.image.width,
      state.image.height
    )

    if (hashRegions) {
      state.left = hashRegions.left
      state.right = hashRegions.right
    } else if (embeddedRegions) {
      state.left = embeddedRegions.left
      state.right = embeddedRegions.right
    } else {
      const fullImage = buildFullImageRegions(state.image.width, state.image.height)
      state.left = fullImage.left
      state.right = fullImage.right
    }

    applyRegions()

    if (hashRegions || embeddedRegions) {
      setStatus("Loaded. Drag to pan, wheel/slider to zoom, use Play Flicker to alternate.")
      return
    }

    showNotConfiguredNotice()
  } catch (err) {
    setStatus(`Load failed: ${err.message}`, true)
  }
}

function bindControls() {
  speedEl.addEventListener("input", () => {
    speedValueEl.value = speedEl.value
    restartFlickerIfNeeded()
  })

  toggleEl.addEventListener("click", toggleFlicker)

  zoomEl.addEventListener("input", () => {
    state.zoom = Number(zoomEl.value) / 100
    syncStageTransform()
  })

  resetViewBtnEl.addEventListener("click", resetView)
  window.addEventListener("resize", () => {
    state.baseScale = computeContainScale()
    syncStageTransform()
  })

  viewportEl.addEventListener("wheel", handleWheelZoom, { passive: false })
  viewportEl.addEventListener("pointerdown", beginPan)
  viewportEl.addEventListener("pointermove", handlePan)
  viewportEl.addEventListener("pointerup", endPan)
  viewportEl.addEventListener("pointercancel", endPan)

  document.addEventListener("keydown", event => {
    if (event.code !== "Space") return

    const activeTag = document.activeElement?.tagName
    if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT" || activeTag === "BUTTON" || document.activeElement?.isContentEditable) return

    event.preventDefault()
    toggleFlicker()
  })
}

function applyRegions() {
  if (!state.image || !state.left || !state.right) return

  stageEl.style.setProperty("--ratio", `${state.left.w} / ${state.left.h}`)
  requestAnimationFrame(() => {
    applyLayerCrop(leftEl, state.left)
    applyLayerCrop(rightEl, state.right)
    resetView()
  })
}

function applyLayerCrop(layerEl, region) {
  const imageWidth = state.image.width
  const imageHeight = state.image.height
  const stageRect = stageEl.getBoundingClientRect()
  const stageWidth = stageRect.width || stageEl.clientWidth || 1
  const stageHeight = stageRect.height || stageEl.clientHeight || 1
  const scaleX = stageWidth / region.w
  const scaleY = stageHeight / region.h

  layerEl.style.backgroundImage = `url("${state.image.id}")`
  layerEl.style.backgroundSize = `${imageWidth * scaleX}px ${imageHeight * scaleY}px`
  layerEl.style.backgroundPosition = `${-region.x * scaleX}px ${-region.y * scaleY}px`
}

function resetView() {
  state.baseScale = computeContainScale()
  state.zoom = 1
  state.panX = 0
  state.panY = 0
  zoomEl.value = "100"
  syncStageTransform()
}

function computeContainScale() {
  stageEl.style.transform = "translate(0px, 0px) scale(1)"
  const viewportRect = viewportEl.getBoundingClientRect()
  const stageRect = stageEl.getBoundingClientRect()

  if (!viewportRect.width || !viewportRect.height || !stageRect.width || !stageRect.height) return 1

  const fitScale = Math.min(viewportRect.width / stageRect.width, viewportRect.height / stageRect.height)
  return clamp(fitScale, 0.1, 1)
}

function stepZoom(delta) {
  const next = clamp(state.zoom + delta, 0.5, 4)
  state.zoom = next
  zoomEl.value = String(Math.round(next * 100))
  syncStageTransform()
}

function handleWheelZoom(event) {
  event.preventDefault()
  const delta = event.deltaY < 0 ? 0.08 : -0.08
  stepZoom(delta)
}

function beginPan(event) {
  if (event.button !== 0) return
  viewportEl.classList.add("dragging")
  state.drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startPanX: state.panX,
    startPanY: state.panY
  }
  viewportEl.setPointerCapture(event.pointerId)
}

function handlePan(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return

  state.panX = state.drag.startPanX + (event.clientX - state.drag.startX)
  state.panY = state.drag.startPanY + (event.clientY - state.drag.startY)
  syncStageTransform()
}

function endPan(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return

  viewportEl.classList.remove("dragging")
  state.drag = null
}

function syncStageTransform() {
  const scale = state.baseScale * state.zoom
  stageEl.style.transform = `translate(${Math.round(state.panX)}px, ${Math.round(state.panY)}px) scale(${scale})`
}

function toggleFlicker() {
  state.flickerOn = !state.flickerOn
  toggleEl.setAttribute("aria-pressed", String(state.flickerOn))
  toggleEl.innerHTML = state.flickerOn ? "&#9208;" : "&#9654;"

  if (!state.flickerOn) {
    stopFlicker()
    rightEl.style.visibility = "visible"
    return
  }

  startFlicker()
}

function restartFlickerIfNeeded() {
  if (!state.flickerOn) return
  startFlicker()
}

function startFlicker() {
  stopFlicker()
  state.rightVisible = true

  const interval = Number(speedEl.value)
  state.flickerTimer = setInterval(() => {
    state.rightVisible = !state.rightVisible
    rightEl.style.visibility = state.rightVisible ? "visible" : "hidden"
  }, interval)
}

function stopFlicker() {
  if (!state.flickerTimer) return
  clearInterval(state.flickerTimer)
  state.flickerTimer = null
}

function buildFullImageRegions(imageWidth, imageHeight) {
  return {
    left: { x: 0, y: 0, w: imageWidth, h: imageHeight },
    right: { x: 0, y: 0, w: imageWidth, h: imageHeight }
  }
}

function normalizeConfiguredRegions(regions, imageWidth, imageHeight) {
  if (!regions) return null

  const left = clampRegionToImage(regions.left, imageWidth, imageHeight)
  const right = clampRegionToImage(regions.right, imageWidth, imageHeight)
  if (!left || !right) return null

  return { left, right }
}

function clampRegionToImage(region, imageWidth, imageHeight) {
  if (!region) return null
  if (!Number.isFinite(region.x) || !Number.isFinite(region.y) || !Number.isFinite(region.w) || !Number.isFinite(region.h)) return null

  const boundedWidth = clamp(Math.round(region.w), 1, imageWidth)
  const boundedHeight = clamp(Math.round(region.h), 1, imageHeight)
  const x = clamp(Math.round(region.x), 0, imageWidth - boundedWidth)
  const y = clamp(Math.round(region.y), 0, imageHeight - boundedHeight)

  return { x, y, w: boundedWidth, h: boundedHeight }
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

function resolveStereographerSourceImage(resource) {
  if (!resource || typeof resource !== "object") return null

  const type = getIiifType(resource)
  const canvas = type === "Manifest"
    ? resource.items?.[0] ?? resource.sequences?.[0]?.canvases?.[0]
    : resource

  const sourceId = resource?.stereographer?.sourceImageId ?? canvas?.stereographer?.sourceImageId
  if (!sourceId) return null

  return {
    id: sourceId,
    width: canvas?.stereographer?.sourceImageWidth,
    height: canvas?.stereographer?.sourceImageHeight
  }
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

function updateEditorLink() {
  const suffix = `${window.location.search}${window.location.hash}`
  openEditorLinkEl.href = `./index.html${suffix}`
}

function setStatus(message, isError = false) {
  if (!overlayEl || !overlayTextEl || !spinnerEl || !overlayHelpEl) return

  if (!isError && message.toLowerCase().startsWith("loaded")) {
    overlayEl.hidden = true
    overlayEl.classList.remove("is-error")
    overlayHelpEl.hidden = true
    overlayHelpEl.textContent = ""
    spinnerEl.hidden = true
    return
  }

  overlayEl.hidden = false
  overlayEl.classList.toggle("is-error", isError)
  overlayTextEl.textContent = message
  overlayHelpEl.hidden = true
  overlayHelpEl.textContent = ""
  spinnerEl.hidden = isError
}

function showNotConfiguredNotice() {
  if (!overlayEl || !overlayTextEl || !spinnerEl || !overlayHelpEl || !openEditorLinkEl) return

  updateEditorLink()
  overlayEl.hidden = false
  overlayEl.classList.remove("is-error")
  overlayTextEl.textContent = "This stereogram has not been configured yet."
  overlayHelpEl.innerHTML = `Configure crop regions in the <a href="${openEditorLinkEl.href}">editor</a>.`
  overlayHelpEl.hidden = false
  spinnerEl.hidden = true
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}
